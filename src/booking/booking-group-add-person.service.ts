import { createHash } from 'crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  ClinicDayStatus,
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
import { PatientBookingGroupAccessService } from '../patient-access/patient-booking-group-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueNumberAllocationService } from '../queue/queue-number-allocation.service';
import { QueueServingOrderPlacementService } from '../queue/queue-serving-order-placement.service';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { AddBookingGroupPersonDto } from './dto/add-booking-group-person.dto';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedGroup = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  servingProtectionEndedAt: Date | null;
  controllingMobileNumberEncrypted: string | null;
};

@Injectable()
export class BookingGroupAddPersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupAccess: PatientBookingGroupAccessService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly answers: BookingAnswerValidationService,
    private readonly admission: BookingConfirmationAdmissionService,
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly queueNumbers: QueueNumberAllocationService,
    private readonly servingOrder: QueueServingOrderPlacementService,
    private readonly bookingReferenceGenerator: BookingReferenceGenerator,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async addPerson(
    bookingGroupId: string,
    rawToken: string,
    dto: AddBookingGroupPersonDto,
    idempotencyKey: string | undefined,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
      scope: { bookingGroupId },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      bookingGroupId,
      firstName: dto.firstName.trim(),
      middleName: dto.middleName?.trim() || null,
      lastName: dto.lastName.trim(),
      suffix: dto.suffix?.trim() || null,
      existingPatientResponse: dto.existingPatientResponse,
      selectedServiceIds: [...dto.selectedServiceIds].sort(),
      answers: (dto.answers ?? []).map((answer) => ({
        bookingQuestionId: answer.bookingQuestionId,
        answerText: answer.answerText ?? null,
        answerNumber: answer.answerNumber ?? null,
        answerBoolean: answer.answerBoolean ?? null,
        selectedOptionValue: answer.selectedOptionValue ?? null,
      })),
    });

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
            bookingGroupId: true,
            queueNumber: true,
            status: true,
            firstName: true,
            lastName: true,
          },
        });
        if (!appointment) {
          throw new ConflictException(
            'Added BookingGroup member result is no longer available.',
          );
        }
        return { appointment, replayed: true };
      }

      const scope = await transaction.bookingGroup.findUnique({
        where: { id: bookingGroupId },
        select: { practiceLocationId: true, serviceDate: true },
      });
      if (!scope) {
        throw new UnauthorizedException('Booking group access is unavailable.');
      }

      await this.acquireQueueScopeLock(
        transaction,
        scope.practiceLocationId,
        scope.serviceDate,
      );
      await this.groupAccess.validateControllerToken(
        transaction,
        rawToken,
        bookingGroupId,
      );

      const group = await this.lockGroup(transaction, bookingGroupId);
      if (
        group.practiceLocationId !== scope.practiceLocationId ||
        group.serviceDate.getTime() !== scope.serviceDate.getTime() ||
        group.servingProtectionEndedAt ||
        !group.controllingMobileNumberEncrypted
      ) {
        throw new ConflictException('Add Person is currently unavailable.');
      }

      await this.assertClinicNotStarted(
        transaction,
        group.practiceLocationId,
        group.serviceDate,
      );

      const memberCount = await transaction.appointment.count({
        where: { bookingGroupId: group.id },
      });
      if (memberCount >= 5) {
        throw new ConflictException(
          'This BookingGroup already has the maximum number of confirmed members.',
        );
      }

      const now = new Date();
      const currentAvailability = await this.availability.resolve(
        group.practiceLocationId,
        group.serviceDate.toISOString().slice(0, 10),
        now,
        transaction,
      );
      if (!currentAvailability.availableForPublicBooking) {
        throw new ConflictException('Add Person is currently unavailable.');
      }

      const { services, estimatedServiceMinutes, preparedAnswers } =
        await this.prepareMember(transaction, group, dto);

      await this.admission.acquireCapacityScopeLock(
        transaction,
        group.practiceLocationId,
        group.serviceDate,
      );
      await this.admission.assertCapacityAvailable(
        transaction,
        group.practiceLocationId,
        group.serviceDate,
        currentAvailability.maximumOperatingUntilAt,
        estimatedServiceMinutes,
      );

      const queueNumber = await this.queueNumbers.allocateNext(
        transaction,
        group.practiceLocationId,
        group.serviceDate,
      );
      const servingOrderKey =
        await this.servingOrder.calculateGroupTailPlacement(
          transaction,
          group.practiceLocationId,
          group.serviceDate,
          group.id,
        );

      const appointment = await transaction.appointment.create({
        data: {
          bookingReference: this.bookingReferenceGenerator.generate(),
          practiceLocationId: group.practiceLocationId,
          bookingGroupId: group.id,
          serviceDate: group.serviceDate,
          estimatedServiceMinutes,
          queueNumber,
          status: AppointmentStatus.WAITING,
          servingOrderKey,
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          firstName: dto.firstName.trim(),
          middleName: dto.middleName?.trim() || null,
          lastName: dto.lastName.trim(),
          suffix: dto.suffix?.trim() || null,
          existingPatientResponse: dto.existingPatientResponse,
          mobileNumberEncrypted: null,
          mobileNumberHash: null,
          mobileNumberLastFour: null,
          activeAppointmentKey: null,
        },
        select: {
          id: true,
          bookingReference: true,
          bookingGroupId: true,
          queueNumber: true,
          status: true,
          firstName: true,
          lastName: true,
        },
      });

      await transaction.appointmentBookedService.createMany({
        data: services.map((service) => ({
          appointmentId: appointment.id,
          practiceLocationServiceId: service.id,
          serviceNameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
        })),
      });
      if (preparedAnswers.length > 0) {
        await transaction.appointmentAnswer.createMany({
          data: preparedAnswers.map((answer) => ({
            appointmentId: appointment.id,
            bookingQuestionId: answer.bookingQuestionId,
            answerText: answer.answerText,
            answerNumber: answer.answerNumber,
            answerBoolean: answer.answerBoolean,
            selectedOptionValue: answer.selectedOptionValue,
          })),
        });
      }

      const completedAt = new Date();
      const completion = this.idempotency.completionTimes(completedAt);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
          requestFingerprint,
          practiceLocationId: group.practiceLocationId,
          serviceDate: group.serviceDate,
          bookingGroupId: group.id,
          resultBookingGroupId: group.id,
          resultAppointmentId: appointment.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: completion.completedAt,
        },
        select: { id: true },
      });

      const message = `${dto.firstName.trim()} ${dto.lastName.trim()} was added successfully. Queue Number: ${queueNumber}. Existing Queue Numbers remain unchanged.`;
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: createHash('sha256')
            .update(
              `${NotificationType.BOOKING_CONFIRMATION}|${commandIdentityKey}|${appointment.id}`,
              'utf8',
            )
            .digest('hex'),
          notificationType: NotificationType.BOOKING_CONFIRMATION,
          channel: NotificationChannel.SMS,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: group.practiceLocationId,
          appointmentId: appointment.id,
          bookingGroupId: group.id,
          commandIdempotencyId: command.id,
          recipientMobileEncrypted: group.controllingMobileNumberEncrypted,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(message),
          providerIdempotencyKey: `booking-group-add-person:${commandIdentityKey}`,
          attemptCount: 0,
          nextAttemptAt: completedAt,
          expiresAt: new Date(
            completedAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
          ),
          createdAt: completedAt,
        },
      });

      return { appointment, replayed: false };
    });
  }

  private async prepareMember(
    transaction: TransactionClient,
    group: LockedGroup,
    dto: AddBookingGroupPersonDto,
  ) {
    const uniqueServiceIds = [...new Set(dto.selectedServiceIds)];
    if (
      uniqueServiceIds.length !== dto.selectedServiceIds.length ||
      uniqueServiceIds.length < 1 ||
      uniqueServiceIds.length > 3
    ) {
      throw new ConflictException('Selected Services are invalid.');
    }

    const [services, questions, location] = await Promise.all([
      transaction.practiceLocationService.findMany({
        where: {
          id: { in: uniqueServiceIds },
          practiceLocationId: group.practiceLocationId,
          status: ServiceAvailabilityStatus.ACTIVE,
        },
        select: { id: true, name: true, durationMinutes: true },
      }),
      transaction.bookingQuestion.findMany({
        where: { practiceLocationId: group.practiceLocationId, isActive: true },
        orderBy: { displayOrder: 'asc' },
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
        where: { id: group.practiceLocationId },
        select: {
          doctorProfile: {
            select: {
              accountSettings: {
                select: { maximumEstimatedServiceMinutesPerPatient: true },
              },
            },
          },
        },
      }),
    ]);

    if (services.length !== uniqueServiceIds.length) {
      throw new ConflictException(
        'Selected Services are no longer available for Add Person.',
      );
    }
    if (!location?.doctorProfile.accountSettings) {
      throw new ConflictException('Add Person is currently unavailable.');
    }

    const preparedAnswers = this.answers.prepareAnswers(
      questions,
      dto.answers,
    );
    if (!this.answers.requiredAnswersComplete(questions, preparedAnswers)) {
      throw new ConflictException(
        'Required BookingQuestions are incomplete for Add Person.',
      );
    }

    const selectedMinutes = services.reduce(
      (total, service) => total + service.durationMinutes,
      0,
    );
    const maximum =
      location.doctorProfile.accountSettings
        .maximumEstimatedServiceMinutesPerPatient;
    const estimatedServiceMinutes =
      maximum === null ? selectedMinutes : Math.min(selectedMinutes, maximum);

    if (
      !Number.isInteger(estimatedServiceMinutes) ||
      estimatedServiceMinutes < 1
    ) {
      throw new ConflictException('Add Person duration is invalid.');
    }

    return { services, estimatedServiceMinutes, preparedAnswers };
  }

  private async acquireQueueScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const identity = `queue|${practiceLocationId}|${serviceDate
      .toISOString()
      .slice(0, 10)}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))
    `);
  }

  private async lockGroup(
    transaction: TransactionClient,
    bookingGroupId: string,
  ): Promise<LockedGroup> {
    const rows = await transaction.$queryRaw<LockedGroup[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "serviceDate",
        "servingProtectionEndedAt",
        "controllingMobileNumberEncrypted"
      FROM "BookingGroup"
      WHERE "id" = ${bookingGroupId}
      FOR UPDATE
    `);
    const group = rows[0];
    if (!group) {
      throw new UnauthorizedException('Booking group access is unavailable.');
    }
    return group;
  }

  private async assertClinicNotStarted(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<
      Array<{ status: ClinicDayStatus }>
    >(Prisma.sql`
      SELECT "status"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    if (rows[0]?.status === ClinicDayStatus.STARTED) {
      throw new ConflictException(
        'Add Person is unavailable after START CLINIC.',
      );
    }
  }
}
