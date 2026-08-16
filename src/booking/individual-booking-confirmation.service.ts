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
import { BookingAccessTokenIssuerService } from './booking-access-token-issuer.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TEXT_ANSWER_MAX_LENGTH = 10_000;

type ConfirmIndividualBookingInput = {
  bookingDraftId: string;
  idempotencyKey: string | undefined;
};

type DraftSnapshot = {
  id: string;
  bookingReference: string;
  practiceLocationId: string;
  serviceDate: Date;
  estimatedServiceMinutes: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  existingPatientResponse: 'YES' | 'NO' | 'UNSURE';
  mobileNumberEncrypted: string;
  mobileNumberHash: string;
  mobileNumberLastFour: string;
  privacyNoticeAcknowledgedAt: Date;
  privacyNoticeVersion: string;
  scheduledReminderOptIn: boolean;
};

type ServiceSnapshot = {
  practiceLocationServiceId: string;
  name: string;
  durationMinutes: number;
};

type CurrentServiceValidation = {
  services: ServiceSnapshot[];
  authoritativeEstimatedServiceMinutes: number;
  practiceLocationName: string;
};

type AnswerSnapshot = {
  bookingQuestionId: string;
  answerText: string | null;
  answerNumber: Prisma.Decimal | null;
  answerBoolean: boolean | null;
  selectedOptionValue: string | null;
  estimatedMinutesAdjustment: number;
};

@Injectable()
export class IndividualBookingConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly admission: BookingConfirmationAdmissionService,
    private readonly queueNumbers: QueueNumberAllocationService,
    private readonly accessTokens: BookingAccessTokenIssuerService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async confirm(input: ConfirmIndividualBookingInput) {
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
      if (replay?.resultAppointmentId) {
        const appointment = await transaction.appointment.findUnique({
          where: { id: replay.resultAppointmentId },
          select: {
            id: true,
            bookingReference: true,
            practiceLocationId: true,
            serviceDate: true,
            queueNumber: true,
            status: true,
          },
        });
        if (!appointment) {
          throw new ConflictException(
            'Confirmed booking result is no longer available.',
          );
        }
        return { appointment, bookingAccessToken: null, replayed: true };
      }

      const admission = await this.admission.lockAndValidateCurrentAdmission(
        transaction,
        input.bookingDraftId,
        now,
      );
      if (admission.draft.mode !== BookingDraftMode.INDIVIDUAL) {
        throw new ConflictException(
          'This confirmation operation is only for individual booking drafts.',
        );
      }

      const draft = await this.loadDraftSnapshot(
        transaction,
        input.bookingDraftId,
      );
      const currentServices = await this.loadAndValidateServices(
        transaction,
        draft.practiceLocationId,
        draft.id,
      );
      const answers = await this.loadAndValidateAnswers(
        transaction,
        draft.practiceLocationId,
        draft.id,
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
        currentServices.authoritativeEstimatedServiceMinutes,
      );

      const queueNumber = await this.queueNumbers.allocateNext(
        transaction,
        draft.practiceLocationId,
        draft.serviceDate,
      );

      const appointment = await transaction.appointment.create({
        data: {
          bookingReference: draft.bookingReference,
          practiceLocationId: draft.practiceLocationId,
          serviceDate: draft.serviceDate,
          estimatedServiceMinutes:
            currentServices.authoritativeEstimatedServiceMinutes,
          queueNumber,
          servingOrderKey: new Prisma.Decimal(queueNumber),
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          firstName: draft.firstName,
          middleName: draft.middleName,
          lastName: draft.lastName,
          suffix: draft.suffix,
          existingPatientResponse: draft.existingPatientResponse,
          mobileNumberEncrypted: draft.mobileNumberEncrypted,
          mobileNumberHash: draft.mobileNumberHash,
          mobileNumberLastFour: draft.mobileNumberLastFour,
          activeAppointmentKey: admission.activeAppointmentKey,
        },
        select: {
          id: true,
          bookingReference: true,
          practiceLocationId: true,
          serviceDate: true,
          queueNumber: true,
          status: true,
        },
      });

      await transaction.appointmentBookedService.createMany({
        data: currentServices.services.map((service) => ({
          appointmentId: appointment.id,
          practiceLocationServiceId: service.practiceLocationServiceId,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
        })),
      });

      if (answers.length > 0) {
        await transaction.appointmentAnswer.createMany({
          data: answers.map((answer) => ({
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

      const issuedToken = await this.accessTokens.issueInitialToken(
        transaction,
        appointment.id,
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
          resultAppointmentId: appointment.id,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      const confirmationMessage = this.buildConfirmationMessage(
        draft,
        currentServices.practiceLocationName,
        queueNumber,
        issuedToken.rawToken,
      );
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.hash(
            `${NotificationType.BOOKING_CONFIRMATION}|${commandIdentityKey}|${appointment.id}`,
          ),
          channel: NotificationChannel.SMS,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: draft.practiceLocationId,
          appointmentId: appointment.id,
          commandIdempotencyId: command.id,
          recipientMobileEncrypted: draft.mobileNumberEncrypted,
          recipientEmailEncrypted: null,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(confirmationMessage),
          providerIdempotencyKey: `booking-confirmation:${commandIdentityKey}`,
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
        appointment,
        bookingAccessToken: {
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
  ): Promise<DraftSnapshot> {
    const draft = await transaction.bookingDraft.findUnique({
      where: { id: bookingDraftId },
      select: {
        id: true,
        bookingReference: true,
        practiceLocationId: true,
        serviceDate: true,
        estimatedServiceMinutes: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        existingPatientResponse: true,
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
      !draft.bookingReference ||
      !draft.estimatedServiceMinutes ||
      !draft.firstName ||
      !draft.lastName ||
      !draft.existingPatientResponse ||
      !draft.mobileNumberEncrypted ||
      !draft.mobileNumberHash ||
      !draft.mobileNumberLastFour ||
      !draft.privacyNoticeAcknowledgedAt ||
      !draft.privacyNoticeVersion
    ) {
      throw new ConflictException(
        'Booking draft is incomplete for confirmation.',
      );
    }
    return draft as DraftSnapshot;
  }

  private async loadAndValidateServices(
    transaction: Prisma.TransactionClient,
    practiceLocationId: string,
    bookingDraftId: string,
  ): Promise<CurrentServiceValidation> {
    const [selections, location] = await Promise.all([
      transaction.bookingDraftServiceSelection.findMany({
        where: { bookingDraftId, bookingDraftMemberId: null },
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
      }),
      transaction.practiceLocation.findUnique({
        where: { id: practiceLocationId },
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

    if (selections.length < 1 || selections.length > 3) {
      throw new ConflictException(
        'Selected Services are no longer valid for confirmation.',
      );
    }
    if (
      selections.some(
        (selection) =>
          selection.practiceLocationService.practiceLocationId !==
            practiceLocationId ||
          selection.practiceLocationService.status !==
            ServiceAvailabilityStatus.ACTIVE ||
          selection.practiceLocationService.durationMinutes < 1,
      )
    ) {
      throw new ConflictException(
        'Selected Services are no longer available for confirmation.',
      );
    }
    const maximumEstimatedServiceMinutesPerPatient =
      location?.doctorProfile.accountSettings
        ?.maximumEstimatedServiceMinutesPerPatient;
    if (!location || maximumEstimatedServiceMinutesPerPatient === undefined) {
      throw new ConflictException(
        'Practice location configuration is incomplete for confirmation.',
      );
    }

    const services = selections.map((selection) => ({
      practiceLocationServiceId: selection.practiceLocationServiceId,
      name: selection.practiceLocationService.name,
      durationMinutes: selection.practiceLocationService.durationMinutes,
    }));
    const selectedServiceMinutes = services.reduce(
      (total, service) => total + service.durationMinutes,
      0,
    );

    return {
      services,
      authoritativeEstimatedServiceMinutes:
        maximumEstimatedServiceMinutesPerPatient === null
          ? selectedServiceMinutes
          : Math.min(
              selectedServiceMinutes,
              maximumEstimatedServiceMinutesPerPatient,
            ),
      practiceLocationName: location.name,
    };
  }

  private async loadAndValidateAnswers(
    transaction: Prisma.TransactionClient,
    practiceLocationId: string,
    bookingDraftId: string,
  ): Promise<AnswerSnapshot[]> {
    const questions = await transaction.bookingQuestion.findMany({
      where: { practiceLocationId, isActive: true },
      select: {
        id: true,
        type: true,
        isRequired: true,
        textMaximumLength: true,
        numberMinimum: true,
        numberMaximum: true,
        selectOptions: true,
      },
    });
    const answers = await transaction.bookingDraftAnswer.findMany({
      where: { bookingDraftId, bookingDraftMemberId: null },
      select: {
        bookingQuestionId: true,
        answerText: true,
        answerNumber: true,
        answerBoolean: true,
        selectedOptionValue: true,
        estimatedMinutesAdjustment: true,
      },
    });
    const currentQuestionById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const currentAnswers = answers.filter((answer) =>
      currentQuestionById.has(answer.bookingQuestionId),
    );

    for (const answer of currentAnswers) {
      const question = currentQuestionById.get(answer.bookingQuestionId)!;
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
    return currentAnswers;
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
  ) {
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
        if (!value || !this.readSelectOptionValues(question.selectOptions).has(value)) {
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
    draft: DraftSnapshot,
    practiceLocationName: string,
    queueNumber: number,
    rawToken: string,
  ): string {
    const baseUrl = process.env.PUBLIC_APP_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new InternalServerErrorException(
        'Public application base URL is not configured.',
      );
    }
    const secureLink = `${baseUrl}/booking/access#token=${encodeURIComponent(rawToken)}`;
    return [
      'Booking confirmed.',
      practiceLocationName,
      draft.serviceDate.toISOString().slice(0, 10),
      `Queue number: ${queueNumber}.`,
      `View your booking: ${secureLink}`,
    ].join(' ');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
