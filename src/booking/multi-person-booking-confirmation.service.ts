import { createHash } from 'crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  BookingDraftMode,
  BookingQuestionType,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  ServiceAvailabilityStatus,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueNumberAllocationService } from '../queue/queue-number-allocation.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingGroupAccessTokenIssuerService } from './booking-group-access-token-issuer.service';
import { BookingReferenceGenerator } from './booking-reference.generator';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TEXT_ANSWER_MAX_LENGTH = 10_000;

type ConfirmMultiPersonBookingInput = {
  bookingDraftId: string;
  idempotencyKey: string | undefined;
};

type GroupDraftSnapshot = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberEncrypted: string;
  mobileNumberHash: string;
  mobileNumberLastFour: string;
  privacyNoticeAcknowledgedAt: Date;
  privacyNoticeVersion: string;
  scheduledReminderOptIn: boolean;
};

type AnswerSnapshot = {
  bookingQuestionId: string;
  answerText: string | null;
  answerNumber: Prisma.Decimal | null;
  answerBoolean: boolean | null;
  selectedOptionValue: string | null;
  estimatedMinutesAdjustment: number;
};

type MemberSnapshot = {
  id: string;
  memberOrder: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  existingPatientResponse: 'YES' | 'NO' | 'UNSURE';
  authoritativeEstimatedServiceMinutes: number;
  services: Array<{
    practiceLocationServiceId: string;
    name: string;
    durationMinutes: number;
  }>;
  answers: AnswerSnapshot[];
};

@Injectable()
export class MultiPersonBookingConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly admission: BookingConfirmationAdmissionService,
    private readonly queueNumbers: QueueNumberAllocationService,
    private readonly groupAccessTokens: BookingGroupAccessTokenIssuerService,
    private readonly bookingReferenceGenerator: BookingReferenceGenerator,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async confirm(input: ConfirmMultiPersonBookingInput) {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey,
      commandType: CommandType.CONVERT_BOOKING_DRAFT,
      scope: { bookingDraftId: input.bookingDraftId },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      bookingDraftId: input.bookingDraftId,
    });
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay?.resultBookingGroupId) {
        const group = await transaction.bookingGroup.findUnique({
          where: { id: replay.resultBookingGroupId },
          select: {
            id: true,
            practiceLocationId: true,
            serviceDate: true,
            appointments: {
              orderBy: { queueNumber: 'asc' },
              select: {
                id: true,
                bookingReference: true,
                queueNumber: true,
                status: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        });
        if (!group) {
          throw new ConflictException(
            'Confirmed booking group result is no longer available.',
          );
        }
        return {
          bookingGroup: group,
          bookingGroupAccessToken: null,
          replayed: true,
        };
      }

      const admission = await this.admission.lockAndValidateCurrentAdmission(
        transaction,
        input.bookingDraftId,
        now,
      );
      if (admission.draft.mode !== BookingDraftMode.MULTI_PERSON) {
        throw new ConflictException(
          'This confirmation operation is only for multi-person booking drafts.',
        );
      }

      const draft = await this.loadDraftSnapshot(
        transaction,
        input.bookingDraftId,
      );
      const { members, practiceLocationName } =
        await this.loadAndValidateMembers(transaction, draft);
      if (members.length < 2 || members.length > 5) {
        throw new ConflictException(
          'Multi-person confirmation requires between two and five members.',
        );
      }

      const totalEstimatedMinutes = members.reduce(
        (total, member) => total + member.authoritativeEstimatedServiceMinutes,
        0,
      );
      await this.admission.acquireCapacityScopeLock(
        transaction,
        draft.practiceLocationId,
        draft.serviceDate,
      );
      await this.admission.assertCapacityAvailable(
        transaction,
        draft.practiceLocationId,
        draft.serviceDate,
        admission.maximumOperatingUntilAt,
        totalEstimatedMinutes,
      );

      const bookingGroup = await transaction.bookingGroup.create({
        data: {
          practiceLocationId: draft.practiceLocationId,
          serviceDate: draft.serviceDate,
          controllingMobileNumberEncrypted: draft.mobileNumberEncrypted,
          controllingMobileNumberHash: draft.mobileNumberHash,
          controllingMobileLastFour: draft.mobileNumberLastFour,
        },
        select: {
          id: true,
          practiceLocationId: true,
          serviceDate: true,
        },
      });

      const appointments: Array<{
        id: string;
        bookingReference: string;
        queueNumber: number;
        status: string;
        firstName: string | null;
        lastName: string | null;
      }> = [];

      for (const member of members) {
        const queueNumber = await this.queueNumbers.allocateNext(
          transaction,
          draft.practiceLocationId,
          draft.serviceDate,
        );
        const appointment = await transaction.appointment.create({
          data: {
            bookingReference: this.bookingReferenceGenerator.generate(),
            practiceLocationId: draft.practiceLocationId,
            bookingGroupId: bookingGroup.id,
            serviceDate: draft.serviceDate,
            estimatedServiceMinutes:
              member.authoritativeEstimatedServiceMinutes,
            queueNumber,
            servingOrderKey: new Prisma.Decimal(queueNumber),
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: member.firstName,
            middleName: member.middleName,
            lastName: member.lastName,
            suffix: member.suffix,
            existingPatientResponse: member.existingPatientResponse,
            mobileNumberEncrypted: null,
            mobileNumberHash: null,
            mobileNumberLastFour: null,
            activeAppointmentKey: null,
          },
          select: {
            id: true,
            bookingReference: true,
            queueNumber: true,
            status: true,
            firstName: true,
            lastName: true,
          },
        });

        if (member.services.length > 0) {
          await transaction.appointmentBookedService.createMany({
            data: member.services.map((service) => ({
              appointmentId: appointment.id,
              practiceLocationServiceId: service.practiceLocationServiceId,
              serviceNameSnapshot: service.name,
              durationMinutesSnapshot: service.durationMinutes,
            })),
          });
        }
        if (member.answers.length > 0) {
          await transaction.appointmentAnswer.createMany({
            data: member.answers.map((answer) => ({
              appointmentId: appointment.id,
              bookingQuestionId: answer.bookingQuestionId,
              answerText: answer.answerText,
              answerNumber: answer.answerNumber,
              answerBoolean: answer.answerBoolean,
              selectedOptionValue: answer.selectedOptionValue,
              estimatedMinutesAdjustment: answer.estimatedMinutesAdjustment,
            })),
          });
        }
        await transaction.contactPreference.create({
          data: {
            appointmentId: appointment.id,
            allowOperationalMessages: true,
            allowFollowUpReminder: draft.scheduledReminderOptIn,
            allowMarketingMessages: false,
            acknowledgedAt: draft.privacyNoticeAcknowledgedAt,
            privacyNoticeVersion: draft.privacyNoticeVersion,
          },
        });
        appointments.push(appointment);
      }

      const issuedToken = await this.groupAccessTokens.issueInitialToken(
        transaction,
        bookingGroup.id,
        draft.serviceDate,
      );
      const completedAt = new Date();
      const times = this.idempotency.completionTimes(completedAt);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey,
          commandIdentityKey,
          commandType: CommandType.CONVERT_BOOKING_DRAFT,
          requestFingerprint,
          practiceLocationId: draft.practiceLocationId,
          serviceDate: draft.serviceDate,
          bookingDraftId: draft.id,
          resultBookingGroupId: bookingGroup.id,
          resultBookingGroupAccessTokenId: issuedToken.tokenRecordId,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      const confirmationMessage = this.buildConfirmationMessage(
        draft,
        practiceLocationName,
        appointments,
        issuedToken.rawToken,
      );
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.hash(
            `${NotificationType.BOOKING_CONFIRMATION}|${commandIdentityKey}|${bookingGroup.id}`,
          ),
          channel: NotificationChannel.SMS,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: draft.practiceLocationId,
          bookingGroupId: bookingGroup.id,
          commandIdempotencyId: command.id,
          recipientMobileEncrypted: draft.mobileNumberEncrypted,
          recipientEmailEncrypted: null,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(confirmationMessage),
          providerIdempotencyKey: `booking-group-confirmation:${commandIdentityKey}`,
          attemptCount: 0,
          nextAttemptAt: completedAt,
          expiresAt: new Date(
            completedAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
          ),
          createdAt: completedAt,
        },
      });

      await transaction.otpVerification.update({
        where: { id: admission.otp.id },
        data: {
          consumedAt: completedAt,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      await transaction.bookingDraft.update({
        where: { id: draft.id },
        data: {
          status: 'CONSUMED',
          consumedAt: completedAt,
          activeDraftKey: null,
          draftControlTokenHash: null,
        },
      });

      return {
        bookingGroup: { ...bookingGroup, appointments },
        bookingGroupAccessToken: {
          token: issuedToken.rawToken,
          expiresAt: issuedToken.expiresAt,
        },
        replayed: false,
      };
    });
  }

  private async loadDraftSnapshot(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
  ): Promise<GroupDraftSnapshot> {
    const draft = await transaction.bookingDraft.findUnique({
      where: { id: bookingDraftId },
      select: {
        id: true,
        practiceLocationId: true,
        serviceDate: true,
        mobileNumberEncrypted: true,
        mobileNumberHash: true,
        mobileNumberLastFour: true,
        privacyNoticeAcknowledgedAt: true,
        privacyNoticeVersion: true,
        scheduledReminderOptIn: true,
      },
    });
    if (
      !draft ||
      !draft.mobileNumberEncrypted ||
      !draft.mobileNumberHash ||
      !draft.mobileNumberLastFour ||
      !draft.privacyNoticeAcknowledgedAt ||
      !draft.privacyNoticeVersion
    ) {
      throw new ConflictException(
        'Multi-person booking draft is incomplete for confirmation.',
      );
    }
    return draft as GroupDraftSnapshot;
  }

  private async loadAndValidateMembers(
    transaction: Prisma.TransactionClient,
    draft: GroupDraftSnapshot,
  ): Promise<{ members: MemberSnapshot[]; practiceLocationName: string }> {
    const [members, questions, location] = await Promise.all([
      transaction.bookingDraftMember.findMany({
        where: { bookingDraftId: draft.id },
        orderBy: { memberOrder: 'asc' },
        select: {
          id: true,
          memberOrder: true,
          firstName: true,
          middleName: true,
          lastName: true,
          suffix: true,
          existingPatientResponse: true,
          serviceSelections: {
            select: {
              practiceLocationServiceId: true,
              practiceLocationService: {
                select: {
                  practiceLocationId: true,
                  name: true,
                  durationMinutes: true,
                  status: true,
                },
              },
            },
          },
          answers: {
            select: {
              bookingQuestionId: true,
              answerText: true,
              answerNumber: true,
              answerBoolean: true,
              selectedOptionValue: true,
              estimatedMinutesAdjustment: true,
            },
          },
        },
      }),
      transaction.bookingQuestion.findMany({
        where: { practiceLocationId: draft.practiceLocationId, isActive: true },
        select: {
          id: true,
          type: true,
          isRequired: true,
          textMaximumLength: true,
          numberMinimum: true,
          numberMaximum: true,
          selectOptions: true,
        },
      }),
      transaction.practiceLocation.findUnique({
        where: { id: draft.practiceLocationId },
        select: {
          name: true,
          doctorProfile: {
            select: {
              accountSettings: {
                select: {
                  maximumEstimatedServiceMinutesPerPatient: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const maximumEstimatedServiceMinutesPerPatient =
      location?.doctorProfile.accountSettings
        ?.maximumEstimatedServiceMinutesPerPatient;
    if (
      !location ||
      !location.name?.trim() ||
      maximumEstimatedServiceMinutesPerPatient === undefined
    ) {
      throw new ConflictException(
        'Practice location configuration is incomplete for confirmation.',
      );
    }

    const questionById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const preparedMembers: MemberSnapshot[] = [];
    for (const member of members) {
      if (
        !member.firstName?.trim() ||
        !member.lastName?.trim() ||
        !member.existingPatientResponse
      ) {
        throw new ConflictException(
          'A group member is incomplete for confirmation.',
        );
      }
      if (
        member.serviceSelections.length < 1 ||
        member.serviceSelections.length > 3
      ) {
        throw new ConflictException(
          'Selected Services are no longer valid for confirmation.',
        );
      }
      if (
        member.serviceSelections.some(
          (selection) =>
            selection.practiceLocationService.practiceLocationId !==
              draft.practiceLocationId ||
            selection.practiceLocationService.status !==
              ServiceAvailabilityStatus.ACTIVE ||
            selection.practiceLocationService.durationMinutes < 1,
        )
      ) {
        throw new ConflictException(
          'Selected Services are no longer available for confirmation.',
        );
      }

      const services = member.serviceSelections.map((selection) => ({
        practiceLocationServiceId: selection.practiceLocationServiceId,
        name: selection.practiceLocationService.name,
        durationMinutes: selection.practiceLocationService.durationMinutes,
      }));
      const serviceMinutes = services.reduce(
        (total, service) => total + service.durationMinutes,
        0,
      );
      const authoritativeEstimatedServiceMinutes =
        maximumEstimatedServiceMinutesPerPatient === null
          ? serviceMinutes
          : Math.min(serviceMinutes, maximumEstimatedServiceMinutesPerPatient);

      const currentAnswers = member.answers.filter((answer) =>
        questionById.has(answer.bookingQuestionId),
      );
      for (const answer of currentAnswers) {
        const question = questionById.get(answer.bookingQuestionId);
        if (!question) {
          throw new ConflictException(
            'BookingQuestion answers are no longer valid for confirmation.',
          );
        }
        this.assertCurrentAnswerValid(question, answer);
      }
      const answeredQuestionIds = new Set(
        currentAnswers.map((answer) => answer.bookingQuestionId),
      );
      if (
        questions.some(
          (question) =>
            question.isRequired && !answeredQuestionIds.has(question.id),
        )
      ) {
        throw new ConflictException(
          'Required booking answers are incomplete for confirmation.',
        );
      }

      preparedMembers.push({
        id: member.id,
        memberOrder: member.memberOrder,
        firstName: member.firstName.trim(),
        middleName: member.middleName?.trim() || null,
        lastName: member.lastName.trim(),
        suffix: member.suffix?.trim() || null,
        existingPatientResponse: member.existingPatientResponse,
        authoritativeEstimatedServiceMinutes,
        services,
        answers: currentAnswers,
      });
    }

    return { members: preparedMembers, practiceLocationName: location.name };
  }

  private assertCurrentAnswerValid(
    question: {
      type: BookingQuestionType;
      textMaximumLength: number | null;
      numberMinimum: Prisma.Decimal | null;
      numberMaximum: Prisma.Decimal | null;
      selectOptions: Prisma.JsonValue | null;
    },
    answer: AnswerSnapshot,
  ): void {
    const populatedFields = [
      answer.answerText !== null,
      answer.answerNumber !== null,
      answer.answerBoolean !== null,
      answer.selectedOptionValue !== null,
    ].filter(Boolean).length;
    if (populatedFields !== 1) {
      throw new ConflictException(
        'BookingQuestion answers are no longer valid for confirmation.',
      );
    }

    switch (question.type) {
      case BookingQuestionType.TEXT: {
        const value = answer.answerText?.trim() ?? '';
        const maximumLength = Math.min(
          question.textMaximumLength ?? ABSOLUTE_TEXT_ANSWER_MAX_LENGTH,
          ABSOLUTE_TEXT_ANSWER_MAX_LENGTH,
        );
        if (!value || value.length > maximumLength) {
          throw new ConflictException(
            'BookingQuestion answers are no longer valid for confirmation.',
          );
        }
        return;
      }
      case BookingQuestionType.NUMBER:
        if (
          answer.answerNumber === null ||
          (question.numberMinimum !== null &&
            answer.answerNumber.lessThan(question.numberMinimum)) ||
          (question.numberMaximum !== null &&
            answer.answerNumber.greaterThan(question.numberMaximum))
        ) {
          throw new ConflictException(
            'BookingQuestion answers are no longer valid for confirmation.',
          );
        }
        return;
      case BookingQuestionType.BOOLEAN:
        if (answer.answerBoolean === null) {
          throw new ConflictException(
            'BookingQuestion answers are no longer valid for confirmation.',
          );
        }
        return;
      case BookingQuestionType.SINGLE_SELECT: {
        const value = answer.selectedOptionValue?.trim() ?? '';
        if (
          !value ||
          !this.readSelectOptionValues(question.selectOptions).has(value)
        ) {
          throw new ConflictException(
            'BookingQuestion answers are no longer valid for confirmation.',
          );
        }
        return;
      }
      default:
        throw new ConflictException(
          'BookingQuestion answers are no longer valid for confirmation.',
        );
    }
  }

  private readSelectOptionValues(selectOptions: Prisma.JsonValue | null) {
    if (!Array.isArray(selectOptions)) {
      return new Set<string>();
    }
    return new Set(
      selectOptions.flatMap((option) => {
        if (
          option &&
          typeof option === 'object' &&
          !Array.isArray(option) &&
          typeof option.value === 'string'
        ) {
          return [option.value];
        }
        return [];
      }),
    );
  }

  private buildConfirmationMessage(
    draft: GroupDraftSnapshot,
    practiceLocationName: string,
    appointments: Array<{
      firstName: string | null;
      lastName: string | null;
      queueNumber: number;
    }>,
    rawToken: string,
  ): string {
    const baseUrl = process.env.PUBLIC_APP_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new InternalServerErrorException(
        'Public application base URL is not configured.',
      );
    }
    const secureLink = `${baseUrl}/booking/group/access#token=${encodeURIComponent(rawToken)}`;
    const members = appointments
      .map((appointment) => {
        const name = [appointment.firstName, appointment.lastName]
          .filter(Boolean)
          .join(' ');
        return `${name}: Queue ${appointment.queueNumber}`;
      })
      .join('; ');
    return [
      'Group booking confirmed.',
      practiceLocationName,
      draft.serviceDate.toISOString().slice(0, 10),
      members,
      `View your group booking: ${secureLink}`,
    ].join(' ');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
