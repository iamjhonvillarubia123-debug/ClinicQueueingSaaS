import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  AppointmentCancelledByType,
  AppointmentStatus,
  ClinicDayStatus,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  PracticeStaffCapabilityType,
  PracticeStaffRole,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { CancelClinicDayDto } from './dto/cancel-clinic-day.dto';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LocationContext = {
  practiceLocationId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
};

type Actor = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  emailVerifiedAt: Date | null;
  passwordHash: string;
};

type ClinicDayState = {
  id: string;
  status: ClinicDayStatus;
  cancelledAt: Date | null;
};

type CancellableAppointment = {
  id: string;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  terminalAt: Date | null;
  mobileNumberEncrypted: string | null;
  allowOperationalMessages: boolean;
};

@Injectable()
export class CancelClinicDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly passwords: PasswordSecurityService,
    private readonly notificationPayload: NotificationPayloadService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async cancel(
    authenticatedUserId: string,
    dto: CancelClinicDayDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const serviceDate = this.parseServiceDate(dto.serviceDate);
    if (dto.acknowledgedServiceDate !== dto.serviceDate) {
      throw new ConflictException(
        'Cancellation acknowledgement must match the exact Service Date.',
      );
    }

    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.CANCEL_CLINIC_DAY,
      scope: {
        practiceLocationId: dto.practiceLocationId,
        serviceDate: dto.serviceDate,
        actorUserId: authenticatedUserId,
      },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
      reason: dto.reason,
      note: dto.note?.trim() || null,
      acknowledgedServiceDate: dto.acknowledgedServiceDate,
    });

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      await this.acquireQueueScopeLock(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );

      const context = await this.lockLocationContext(
        transaction,
        dto.practiceLocationId,
      );
      const actor = await this.lockActor(transaction, authenticatedUserId);
      await this.assertAuthority(
        transaction,
        context,
        dto.practiceLocationId,
        actor,
      );

      const passwordMatches = await this.passwords.verify(
        dto.password,
        actor.passwordHash,
      );
      if (!passwordMatches) {
        throw new ForbiddenException('Password re-authentication failed.');
      }

      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        return this.readReplayResult(
          transaction,
          dto.practiceLocationId,
          serviceDate,
        );
      }

      const clinicDay = await this.lockOrCreateClinicDay(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      if (!this.isCancellableClinicDay(clinicDay.status)) {
        throw new ConflictException(
          'Clinic day is not eligible for cancellation in its current state.',
        );
      }

      const appointments = await this.lockCancellableAppointments(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const now = new Date();
      const cancelledByType =
        actor.role === UserRole.DOCTOR
          ? AppointmentCancelledByType.DOCTOR
          : AppointmentCancelledByType.SECRETARY;
      let nextSequence = await this.nextQueueEventSequence(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );

      for (const appointment of appointments) {
        await transaction.appointment.update({
          where: { id: appointment.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            servingOrderKey: null,
            waitingPlacementType: null,
            activeAppointmentKey: null,
            cancelledAt: now,
            terminalAt: now,
            cancelledByType,
            cancellationReason: 'CLINIC_DAY_CANCELLED',
          },
        });

        const event = await transaction.queueEvent.create({
          data: {
            practiceLocationId: dto.practiceLocationId,
            serviceDate,
            queueEventSequence: nextSequence,
            type: QueueEventType.APPOINTMENT_CANCELLED,
            actorType: QueueEventActorType.USER,
            actorUserId: authenticatedUserId,
            previousPrimaryStatus: appointment.status,
            newPrimaryStatus: AppointmentStatus.CANCELLED,
            previousPrimaryOrderKey: appointment.servingOrderKey,
            newPrimaryOrderKey: null,
            previousPrimaryWaitingPlacementType:
              appointment.waitingPlacementType,
            newPrimaryWaitingPlacementType: null,
            previousPrimaryTerminalAt: appointment.terminalAt,
            newPrimaryTerminalAt: now,
            metadata: { source: 'CLINIC_DAY_CANCELLATION' },
            createdAt: now,
          },
          select: { id: true },
        });

        await transaction.queueEventAppointmentLink.create({
          data: {
            queueEventId: event.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: appointment.id,
          },
        });

        if (
          appointment.mobileNumberEncrypted &&
          appointment.allowOperationalMessages
        ) {
          await transaction.notificationOutbox.create({
            data: {
              deliveryIdentityKey: this.hash(
                `${NotificationType.CLINIC_DAY_CANCELLATION}|${clinicDay.id}|${appointment.id}`,
              ),
              notificationType: NotificationType.CLINIC_DAY_CANCELLATION,
              channel: NotificationChannel.SMS,
              status: NotificationOutboxStatus.PENDING,
              practiceLocationId: dto.practiceLocationId,
              appointmentId: appointment.id,
              recipientMobileEncrypted: appointment.mobileNumberEncrypted,
              recipientEmailEncrypted: null,
              messageBodyEncrypted: this.notificationPayload.encryptMessage(
                'Your clinic appointment has been cancelled because the clinic will not be available on this Service Date. Please contact the clinic if you need assistance arranging another appointment.',
              ),
              providerIdempotencyKey: `clinic-day-cancel:${clinicDay.id}:${appointment.id}`,
              attemptCount: 0,
              nextAttemptAt: now,
              expiresAt: new Date(now.getTime() + OUTBOX_RETENTION_MS),
              createdAt: now,
            },
          });
        }

        nextSequence += 1n;
      }

      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: {
          status: ClinicDayStatus.CANCELLED,
          cancelledAt: now,
          cancelledByUserId: authenticatedUserId,
          cancellationReason: dto.reason,
          cancellationNote: dto.note?.trim() || null,
        },
      });

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType: CommandType.CANCEL_CLINIC_DAY,
          requestFingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          actorUserId: authenticatedUserId,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        replayed: false,
        clinicDayId: clinicDay.id,
        status: ClinicDayStatus.CANCELLED,
        cancelledAt: now,
        cancelledAppointmentCount: appointments.length,
      };
    });
  }

  private parseServiceDate(value: string): Date {
    const parsed = this.scheduleTime.parseServiceDate(value);
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  }

  private async readReplayResult(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ) {
    const clinicDay = await transaction.clinicDay.findUnique({
      where: {
        practiceLocationId_serviceDate: { practiceLocationId, serviceDate },
      },
      select: { id: true, status: true, cancelledAt: true },
    });
    if (!clinicDay || clinicDay.status !== ClinicDayStatus.CANCELLED) {
      throw new ConflictException(
        'Clinic day cancellation replay result is inconsistent.',
      );
    }
    return {
      replayed: true,
      clinicDayId: clinicDay.id,
      status: clinicDay.status,
      cancelledAt: clinicDay.cancelledAt,
      cancelledAppointmentCount: null,
    };
  }

  private async acquireQueueScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const lockIdentity = `queue|${practiceLocationId}|${this.dateKey(serviceDate)}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
    `);
  }

  private async lockLocationContext(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<LocationContext> {
    const rows = await transaction.$queryRaw<LocationContext[]>(Prisma.sql`
      SELECT
        pl."id" AS "practiceLocationId",
        pl."lifecycleStatus",
        dp."userId" AS "doctorUserId"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const context = rows[0];
    if (!context) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (context.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE) {
      throw new ConflictException('Practice location is not operational.');
    }
    return context;
  }

  private async lockActor(
    transaction: TransactionClient,
    actorUserId: string,
  ): Promise<Actor> {
    const rows = await transaction.$queryRaw<Actor[]>(Prisma.sql`
      SELECT
        "id",
        "role",
        "accountStatus",
        "administrativeRestrictionStatus",
        "emailVerifiedAt",
        "passwordHash"
      FROM "User"
      WHERE "id" = ${actorUserId}
      LIMIT 1
      FOR UPDATE
    `);
    const actor = rows[0];
    if (
      !actor ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Current user cannot cancel this clinic day.',
      );
    }
    return actor;
  }

  private async assertAuthority(
    transaction: TransactionClient,
    context: LocationContext,
    practiceLocationId: string,
    actor: Actor,
  ): Promise<void> {
    if (actor.role === UserRole.DOCTOR) {
      if (actor.id !== context.doctorUserId) {
        throw new ForbiddenException(
          'Current user cannot cancel this clinic day.',
        );
      }
      return;
    }

    if (actor.role !== UserRole.SECRETARY || !actor.emailVerifiedAt) {
      throw new ForbiddenException(
        'Current user cannot cancel this clinic day.',
      );
    }

    const staff = await transaction.practiceStaff.findFirst({
      where: {
        userId: actor.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
        disconnectedAt: null,
      },
      select: { id: true },
    });
    if (!staff) {
      throw new ForbiddenException(
        'Secretary is not operationally ready for this Practice Location.',
      );
    }

    const capability = await transaction.practiceStaffCapability.findFirst({
      where: {
        practiceStaffId: staff.id,
        capabilityType: PracticeStaffCapabilityType.CANCEL_CLINIC_DAY,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!capability) {
      throw new ForbiddenException(
        'Secretary lacks CANCEL CLINIC DAY capability.',
      );
    }
  }

  private async lockOrCreateClinicDay(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<ClinicDayState> {
    let rows = await transaction.$queryRaw<ClinicDayState[]>(Prisma.sql`
      SELECT "id", "status", "cancelledAt"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    if (rows[0]) return rows[0];

    await transaction.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate,
        status: ClinicDayStatus.NOT_STARTED,
      },
    });
    rows = await transaction.$queryRaw<ClinicDayState[]>(Prisma.sql`
      SELECT "id", "status", "cancelledAt"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    const clinicDay = rows[0];
    if (!clinicDay) {
      throw new ConflictException('Clinic day could not be prepared.');
    }
    return clinicDay;
  }

  private async lockCancellableAppointments(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<CancellableAppointment[]> {
    return transaction.$queryRaw<CancellableAppointment[]>(Prisma.sql`
      SELECT
        a."id",
        a."status",
        a."servingOrderKey",
        a."waitingPlacementType",
        a."terminalAt",
        a."mobileNumberEncrypted",
        COALESCE(cp."allowOperationalMessages", TRUE) AS "allowOperationalMessages"
      FROM "Appointment" a
      LEFT JOIN "ContactPreference" cp ON cp."appointmentId" = a."id"
      WHERE a."practiceLocationId" = ${practiceLocationId}
        AND a."serviceDate" = ${serviceDate}
        AND a."status" IN (
          ${AppointmentStatus.WAITING}::"AppointmentStatus",
          ${AppointmentStatus.CALLED}::"AppointmentStatus",
          ${AppointmentStatus.TEMPORARILY_ABSENT}::"AppointmentStatus",
          ${AppointmentStatus.OUT_FOR_PROCEDURE}::"AppointmentStatus"
        )
      ORDER BY a."id"
      FOR UPDATE OF a
    `);
  }

  private isCancellableClinicDay(status: ClinicDayStatus): boolean {
    return (
      status === ClinicDayStatus.NOT_STARTED ||
      status === ClinicDayStatus.DELAYED ||
      status === ClinicDayStatus.STARTED
    );
  }

  private async nextQueueEventSequence(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<bigint> {
    const latest = await transaction.queueEvent.findFirst({
      where: { practiceLocationId, serviceDate },
      select: { queueEventSequence: true },
      orderBy: { queueEventSequence: 'desc' },
    });
    return (latest?.queueEventSequence ?? 0n) + 1n;
  }

  private dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
