import { ConflictException, Injectable } from '@nestjs/common';
import {
  BookingDraftMode,
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

      const draft = await this.loadDraftSnapshot(transaction, input.bookingDraftId);
      const services = await this.loadAndValidateServices(
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
        draft.estimatedServiceMinutes,
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
          estimatedServiceMinutes: draft.estimatedServiceMinutes,
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

      if (services.length > 0) {
        await transaction.appointmentBookedService.createMany({
          data: services.map((service) => ({
            appointmentId: appointment.id,
            practiceLocationServiceId: service.practiceLocationServiceId,
            serviceNameSnapshot: service.name,
            durationMinutesSnapshot: service.durationMinutes,
          })),
        });
      }

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

      const confirmationMessage = [
        `Booking confirmed: ${draft.bookingReference}.`,
        `Queue number: ${queueNumber}.`,
      ].join(' ');
      await transaction.notificationOutbox.create({
        data: {
          channel: NotificationChannel.SMS,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: draft.practiceLocationId,
          appointmentId: appointment.id,
          recipientMobileEncrypted: draft.mobileNumberEncrypted,
          recipientMobileLastFour: draft.mobileNumberLastFour,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(confirmationMessage),
          nextAttemptAt: now,
        },
      });

      await transaction.otpVerification.update({
        where: { id: admission.otp.id },
        data: {
          consumedAt: now,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      await transaction.bookingDraft.update({
        where: { id: draft.id },
        data: {
          status: 'CONSUMED',
          consumedAt: now,
          activeDraftKey: null,
          draftControlTokenHash: null,
        },
      });

      const times = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
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
  ): Promise<ServiceSnapshot[]> {
    const selections = await transaction.bookingDraftServiceSelection.findMany({
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
    });
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
            ServiceAvailabilityStatus.ACTIVE,
      )
    ) {
      throw new ConflictException(
        'Selected Services are no longer available for confirmation.',
      );
    }
    return selections.map((selection) => ({
      practiceLocationServiceId: selection.practiceLocationServiceId,
      name: selection.practiceLocationService.name,
      durationMinutes: selection.practiceLocationService.durationMinutes,
    }));
  }

  private async loadAndValidateAnswers(
    transaction: Prisma.TransactionClient,
    practiceLocationId: string,
    bookingDraftId: string,
  ): Promise<AnswerSnapshot[]> {
    const questions = await transaction.bookingQuestion.findMany({
      where: { practiceLocationId, isActive: true },
      select: { id: true, isRequired: true },
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
    const answeredQuestionIds = new Set(
      answers.map((answer) => answer.bookingQuestionId),
    );
    if (
      questions.some(
        (question) => question.isRequired && !answeredQuestionIds.has(question.id),
      )
    ) {
      throw new ConflictException(
        'Required booking answers are incomplete for confirmation.',
      );
    }
    return answers.filter((answer) =>
      questions.some((question) => question.id === answer.bookingQuestionId),
    );
  }
}
