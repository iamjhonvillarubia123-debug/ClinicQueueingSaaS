import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueNumberAllocationService } from '../queue/queue-number-allocation.service';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { CreateStaffAppointmentDto } from './dto/create-staff-appointment.dto';

@Injectable()
export class StaffAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly mobile: MobileNumberService,
    private readonly identities: ActiveBookingIdentityService,
    private readonly answers: BookingAnswerValidationService,
    private readonly admission: BookingConfirmationAdmissionService,
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly queueNumbers: QueueNumberAllocationService,
    private readonly references: BookingReferenceGenerator,
  ) {}

  async create(
    actorUserId: string,
    dto: CreateStaffAppointmentDto,
    rawKey?: string,
  ) {
    const idempotencyKey = this.idempotency.normalizeKey(rawKey);
    const serviceDate = this.parseDate(dto.serviceDate);
    const protectedMobile = this.mobile.protect(dto.mobileNumber);
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey,
      commandType: CommandType.CREATE_STAFF_APPOINTMENT,
      scope: { actorUserId, practiceLocationId: dto.practiceLocationId },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      actorUserId,
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      firstName: dto.firstName,
      middleName: dto.middleName,
      lastName: dto.lastName,
      suffix: dto.suffix,
      existingPatientResponse: dto.existingPatientResponse,
      mobileNumber: dto.mobileNumber,
      selectedServiceIds: dto.selectedServiceIds,
      answers: dto.answers?.map((answer) => ({
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
        return {
          appointment: await transaction.appointment.findUniqueOrThrow({
            where: { id: replay.resultAppointmentId },
          }),
          replayed: true,
        };
      }

      const context = await transaction.practiceLocation.findUnique({
        where: { id: dto.practiceLocationId },
        select: {
          lifecycleStatus: true,
          currentRegularPracticeStaffId: true,
          doctorProfile: {
            select: {
              id: true,
              userId: true,
              accountSettings: {
                select: { maximumEstimatedServiceMinutesPerPatient: true },
              },
            },
          },
          clinicDays: {
            where: { serviceDate },
            select: {
              id: true,
              status: true,
              operatingPracticeStaff: {
                select: { id: true, userId: true, isActive: true },
              },
            },
            take: 1,
          },
        },
      });
      if (!context)
        throw new NotFoundException('Practice location was not found.');
      if (context.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE)
        throw new ConflictException('Practice location is not operational.');
      const actor = await transaction.user.findUnique({
        where: { id: actorUserId },
        select: { accountStatus: true, administrativeRestrictionStatus: true },
      });
      const day = context.clinicDays[0];
      const isOwningDoctor = context.doctorProfile.userId === actorUserId;
      const isOperatingSecretary =
        day?.operatingPracticeStaff?.isActive === true &&
        day.operatingPracticeStaff.userId === actorUserId;
      const authorized =
        actor?.accountStatus === UserAccountStatus.ACTIVE &&
        actor.administrativeRestrictionStatus ===
          AdministrativeRestrictionStatus.NONE &&
        (isOwningDoctor || isOperatingSecretary);
      if (!authorized)
        throw new ForbiddenException(
          'Current user cannot create staff-assisted appointments for this clinic day.',
        );
      if (!day || day.status !== 'STARTED')
        throw new ConflictException(
          'Staff-assisted booking requires a started clinic day.',
        );

      if (
        !isOwningDoctor &&
        day.operatingPracticeStaff?.id === context.currentRegularPracticeStaffId
      ) {
        const intakeAuthority =
          await transaction.practiceStaffAuthorityBundle.findFirst({
            where: {
              practiceStaffId: day.operatingPracticeStaff.id,
              bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE',
              status: 'ACTIVE',
            },
            select: { id: true },
          });
        if (!intakeAuthority) {
          throw new ForbiddenException(
            'Regular Clinic Secretary requires APPOINTMENTS_AND_PATIENT_INTAKE authority.',
          );
        }
      }

      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`DOCTOR_SCHEDULE|${context.doctorProfile.id}`}, 0)
        )
      `);

      const services = await transaction.practiceLocationService.findMany({
        where: {
          id: { in: dto.selectedServiceIds },
          practiceLocationId: dto.practiceLocationId,
          status: ServiceAvailabilityStatus.ACTIVE,
        },
        select: { id: true, name: true, durationMinutes: true },
      });
      if (
        services.length !== dto.selectedServiceIds.length ||
        new Set(dto.selectedServiceIds).size !== dto.selectedServiceIds.length
      )
        throw new ConflictException('Selected Services are not available.');
      const selectedMinutes = services.reduce(
        (sum, service) => sum + service.durationMinutes,
        0,
      );
      const maximum =
        context.doctorProfile.accountSettings
          ?.maximumEstimatedServiceMinutesPerPatient;
      if (maximum === undefined)
        throw new ConflictException(
          'Practice location configuration is incomplete.',
        );
      const estimatedServiceMinutes =
        maximum === null ? selectedMinutes : Math.min(selectedMinutes, maximum);

      const questions = await this.answers.loadActiveQuestions(
        dto.practiceLocationId,
      );
      const preparedAnswers = this.answers.prepareAnswers(
        questions,
        dto.answers,
      );
      if (!this.answers.requiredAnswersComplete(questions, preparedAnswers))
        throw new ConflictException('Required booking answers are incomplete.');

      const activeAppointmentKey = this.identities.deriveAppointmentKey(
        protectedMobile.hash,
        dto.practiceLocationId,
        serviceDate,
      );
      await this.identities.acquireAppointmentScopeLock(
        transaction,
        activeAppointmentKey,
      );
      await this.identities.assertNoActivePublicBookingContext(
        transaction,
        activeAppointmentKey,
        protectedMobile.hash,
        dto.practiceLocationId,
        serviceDate,
      );
      const schedule = await this.availability.resolveCapacitySchedule(
        dto.practiceLocationId,
        dto.serviceDate,
        transaction,
      );
      await this.admission.acquireCapacityScopeLock(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      await this.admission.assertCapacityAvailable(
        transaction,
        dto.practiceLocationId,
        serviceDate,
        schedule.maximumOperatingUntilAt,
        estimatedServiceMinutes,
      );
      const queueNumber = await this.queueNumbers.allocateNext(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const appointment = await transaction.appointment.create({
        data: {
          bookingReference: this.references.generate(),
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          estimatedServiceMinutes,
          queueNumber,
          servingOrderKey: new Prisma.Decimal(queueNumber),
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          firstName: dto.firstName.trim(),
          middleName: dto.middleName?.trim() || null,
          lastName: dto.lastName.trim(),
          suffix: dto.suffix?.trim() || null,
          existingPatientResponse: dto.existingPatientResponse,
          mobileNumberEncrypted: protectedMobile.encrypted,
          mobileNumberHash: protectedMobile.hash,
          mobileNumberLastFour: protectedMobile.lastFour,
          activeAppointmentKey,
          createdByUserId: actorUserId,
          bookedServices: {
            create: services.map((service) => ({
              practiceLocationServiceId: service.id,
              serviceNameSnapshot: service.name,
              durationMinutesSnapshot: service.durationMinutes,
            })),
          },
          appointmentAnswers: {
            create: preparedAnswers.map((answer) => ({
              ...answer,
              estimatedMinutesAdjustment: 0,
            })),
          },
        },
      });
      const times = this.idempotency.completionTimes();
      await transaction.commandIdempotency.create({
        data: {
          commandType: CommandType.CREATE_STAFF_APPOINTMENT,
          idempotencyKey,
          commandIdentityKey,
          requestFingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          actorUserId,
          resultAppointmentId: appointment.id,
          ...times,
        },
      });
      return { appointment, replayed: false };
    });
  }

  private parseDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new ConflictException('Service Date is invalid.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new ConflictException('Service Date is invalid.');
    return date;
  }
}
