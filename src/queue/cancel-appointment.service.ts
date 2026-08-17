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
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PracticeStaffRole,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppointmentCancellationReason,
  CancelAppointmentDto,
} from './dto/cancel-appointment.dto';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type TargetAppointment = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  bookingGroupId: string | null;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  terminalAt: Date | null;
  mobileNumberEncrypted: string | null;
  allowOperationalMessages: boolean;
};

type Actor = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
};

type QueueContext = {
  doctorUserId: string;
};

@Injectable()
export class CancelAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async cancel(
    authenticatedUserId: string,
    dto: CancelAppointmentDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);

    return this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.appointment.findUnique({
        where: { id: dto.appointmentId },
        select: { practiceLocationId: true, serviceDate: true },
      });
      if (!initial) {
        throw new NotFoundException('Appointment was not found.');
      }

      await this.acquireQueueScopeLock(
        transaction,
        initial.practiceLocationId,
        initial.serviceDate,
      );

      const target = await this.lockTargetAppointment(
        transaction,
        dto.appointmentId,
      );
      if (target.bookingGroupId) {
        throw new ConflictException(
          'BookingGroup member cancellation requires the protected group cancellation workflow.',
        );
      }

      const context = await this.lockQueueContext(
        transaction,
        target.practiceLocationId,
      );
      const actor = await this.lockActor(transaction, authenticatedUserId);
      await this.assertAuthority(
        transaction,
        context,
        target.practiceLocationId,
        actor,
      );

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey: key,
        commandType: CommandType.CANCEL_APPOINTMENT,
        scope: {
          practiceLocationId: target.practiceLocationId,
          serviceDate: this.dateKey(target.serviceDate),
          appointmentId: target.id,
          actorUserId: authenticatedUserId,
        },
      });
      const requestFingerprint = this.idempotency.fingerprint({
        reason: dto.reason,
        note: dto.note?.trim() || null,
      });

      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        return this.readReplayResult(
          transaction,
          replay.resultAppointmentId,
          replay.resultQueueEventId,
        );
      }

      if (!this.isCancellableStatus(target.status)) {
        throw new ConflictException(
          'Appointment is not eligible for cancellation in its current state.',
        );
      }

      const now = new Date();
      const persistedReason = this.persistedReason(dto.reason, dto.note);
      const cancelledByType =
        actor.role === UserRole.DOCTOR
          ? AppointmentCancelledByType.DOCTOR
          : AppointmentCancelledByType.SECRETARY;

      await transaction.appointment.update({
        where: { id: target.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          servingOrderKey: null,
          waitingPlacementType: null,
          activeAppointmentKey: null,
          cancelledAt: now,
          terminalAt: now,
          cancelledByType,
          cancellationReason: persistedReason,
        },
      });

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        target.practiceLocationId,
        target.serviceDate,
      );
      const event = await transaction.queueEvent.create({
        data: {
          practiceLocationId: target.practiceLocationId,
          serviceDate: target.serviceDate,
          queueEventSequence,
          type: QueueEventType.APPOINTMENT_CANCELLED,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          previousPrimaryStatus: target.status,
          newPrimaryStatus: AppointmentStatus.CANCELLED,
          previousPrimaryOrderKey: target.servingOrderKey,
          newPrimaryOrderKey: null,
          previousPrimaryWaitingPlacementType: target.waitingPlacementType,
          newPrimaryWaitingPlacementType: null,
          previousPrimaryTerminalAt: target.terminalAt,
          newPrimaryTerminalAt: now,
          createdAt: now,
        },
        select: { id: true },
      });
      await transaction.queueEventAppointmentLink.create({
        data: {
          queueEventId: event.id,
          role: QueueEventAppointmentLinkRole.PRIMARY,
          appointmentId: target.id,
        },
      });

      if (target.mobileNumberEncrypted && target.allowOperationalMessages) {
        await transaction.notificationOutbox.create({
          data: {
            deliveryIdentityKey: this.hash(
              `${NotificationType.APPOINTMENT_CANCELLATION}|${event.id}|${target.id}`,
            ),
            notificationType: NotificationType.APPOINTMENT_CANCELLATION,
            channel: NotificationChannel.SMS,
            status: NotificationOutboxStatus.PENDING,
            practiceLocationId: target.practiceLocationId,
            appointmentId: target.id,
            recipientMobileEncrypted: target.mobileNumberEncrypted,
            recipientEmailEncrypted: null,
            messageBodyEncrypted: this.notificationPayload.encryptMessage(
              'Your clinic appointment has been cancelled. Please review your booking access page or contact the clinic if you need assistance.',
            ),
            providerIdempotencyKey: `appointment-cancel:${event.id}`,
            attemptCount: 0,
            nextAttemptAt: now,
            expiresAt: new Date(now.getTime() + OUTBOX_RETENTION_MS),
            createdAt: now,
          },
        });
      }

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType: CommandType.CANCEL_APPOINTMENT,
          requestFingerprint,
          practiceLocationId: target.practiceLocationId,
          serviceDate: target.serviceDate,
          appointmentId: target.id,
          actorUserId: authenticatedUserId,
          resultAppointmentId: target.id,
          resultQueueEventId: event.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        replayed: false,
        appointmentId: target.id,
        queueEventId: event.id,
        status: AppointmentStatus.CANCELLED,
        cancelledAt: now,
        queueNumberPreserved: true,
      };
    });
  }

  private async readReplayResult(
    transaction: TransactionClient,
    appointmentId: string | null,
    queueEventId: string | null,
  ) {
    if (!appointmentId || !queueEventId) {
      throw new ConflictException(
        'Appointment cancellation replay record is incomplete.',
      );
    }
    const [appointment, event] = await Promise.all([
      transaction.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, status: true, cancelledAt: true },
      }),
      transaction.queueEvent.findUnique({
        where: { id: queueEventId },
        select: { id: true, type: true },
      }),
    ]);
    if (
      !appointment ||
      !event ||
      event.type !== QueueEventType.APPOINTMENT_CANCELLED
    ) {
      throw new ConflictException(
        'Appointment cancellation replay result is inconsistent.',
      );
    }
    return {
      replayed: true,
      appointmentId: appointment.id,
      queueEventId: event.id,
      status: appointment.status,
      cancelledAt: appointment.cancelledAt,
      queueNumberPreserved: true,
    };
  }

  private async lockTargetAppointment(
    transaction: TransactionClient,
    appointmentId: string,
  ): Promise<TargetAppointment> {
    const rows = await transaction.$queryRaw<TargetAppointment[]>(Prisma.sql`
      SELECT
        a."id",
        a."practiceLocationId",
        a."serviceDate",
        a."bookingGroupId",
        a."status",
        a."servingOrderKey",
        a."waitingPlacementType",
        a."terminalAt",
        a."mobileNumberEncrypted",
        COALESCE(cp."allowOperationalMessages", TRUE) AS "allowOperationalMessages"
      FROM "Appointment" a
      LEFT JOIN "ContactPreference" cp ON cp."appointmentId" = a."id"
      WHERE a."id" = ${appointmentId}
      LIMIT 1
      FOR UPDATE OF a
    `);
    const target = rows[0];
    if (!target) {
      throw new NotFoundException('Appointment was not found.');
    }
    return target;
  }

  private async lockQueueContext(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<QueueContext> {
    const rows = await transaction.$queryRaw<QueueContext[]>(Prisma.sql`
      SELECT dp."userId" AS "doctorUserId"
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
    return context;
  }

  private async lockActor(
    transaction: TransactionClient,
    actorUserId: string,
  ): Promise<Actor> {
    const rows = await transaction.$queryRaw<Actor[]>(Prisma.sql`
      SELECT "id", "role", "accountStatus", "administrativeRestrictionStatus"
      FROM "User"
      WHERE "id" = ${actorUserId}
      LIMIT 1
      FOR UPDATE
    `);
    const actor = rows[0];
    if (
      !actor ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Current user cannot cancel this Appointment.',
      );
    }
    return actor;
  }

  private async assertAuthority(
    transaction: TransactionClient,
    context: QueueContext,
    practiceLocationId: string,
    actor: Actor,
  ): Promise<void> {
    if (actor.role === UserRole.DOCTOR) {
      if (actor.id !== context.doctorUserId) {
        throw new ForbiddenException(
          'Current user cannot cancel this Appointment.',
        );
      }
      return;
    }
    if (actor.role !== UserRole.SECRETARY) {
      throw new ForbiddenException(
        'Current user cannot cancel this Appointment.',
      );
    }
    const staff = await transaction.practiceStaff.findFirst({
      where: {
        practiceLocationId,
        userId: actor.id,
        isActive: true,
        staffRole: PracticeStaffRole.SECRETARY,
      },
      select: { id: true },
    });
    if (!staff) {
      throw new ForbiddenException(
        'Secretary is not assigned to this Practice Location.',
      );
    }
  }

  private isCancellableStatus(status: AppointmentStatus): boolean {
    return (
      status === AppointmentStatus.WAITING ||
      status === AppointmentStatus.CALLED ||
      status === AppointmentStatus.TEMPORARILY_ABSENT ||
      status === AppointmentStatus.OUT_FOR_PROCEDURE
    );
  }

  private persistedReason(
    reason: AppointmentCancellationReason,
    note: string | undefined,
  ): string {
    if (reason !== 'OTHER') return reason;
    return `OTHER: ${note?.trim() ?? ''}`;
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
