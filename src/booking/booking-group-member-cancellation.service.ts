import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentCancelledByType,
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BookingGroupMemberCancellationReason,
  CancelBookingGroupMemberDto,
} from './dto/cancel-booking-group-member.dto';

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedMember = {
  id: string;
  bookingGroupId: string | null;
  practiceLocationId: string;
  serviceDate: Date;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: string | null;
  terminalAt: Date | null;
  calledAt: Date | null;
};

type LockedGroup = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  controllingMobileNumberEncrypted: string | null;
  servingProtectionEndedAt: Date | null;
};

@Injectable()
export class BookingGroupMemberCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async cancel(
    bookingGroupId: string,
    appointmentId: string,
    rawAccessToken: string,
    dto: CancelBookingGroupMemberDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const tokenHash = this.hash(rawAccessToken);

    return this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          practiceLocationId: true,
          serviceDate: true,
          bookingGroupId: true,
        },
      });
      if (!initial || initial.bookingGroupId !== bookingGroupId) {
        throw new NotFoundException('BookingGroup member was not found.');
      }

      await this.acquireQueueScopeLock(
        transaction,
        initial.practiceLocationId,
        initial.serviceDate,
      );

      const group = await this.lockGroup(transaction, bookingGroupId);
      const member = await this.lockMember(transaction, appointmentId);
      if (member.bookingGroupId !== group.id) {
        throw new ConflictException(
          'Appointment no longer belongs to the requested BookingGroup.',
        );
      }
      if (
        member.practiceLocationId !== group.practiceLocationId ||
        member.serviceDate.getTime() !== group.serviceDate.getTime()
      ) {
        throw new ConflictException(
          'BookingGroup member queue scope is inconsistent.',
        );
      }

      const accessTokenId = await this.assertControllerAccess(
        transaction,
        group.id,
        tokenHash,
      );

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey: key,
        commandType: CommandType.BOOKING_GROUP_CANCEL_MEMBER,
        scope: {
          bookingGroupId: group.id,
          appointmentId: member.id,
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
        await transaction.bookingGroupAccessToken.update({
          where: { id: accessTokenId },
          data: { lastUsedAt: new Date() },
        });
        return this.readReplayResult(
          transaction,
          replay.resultBookingGroupId,
          replay.resultAppointmentId,
          replay.resultQueueEventId,
        );
      }

      if (!this.isCancellableStatus(member.status)) {
        throw new ConflictException(
          'BookingGroup member is not eligible for cancellation in its current state.',
        );
      }

      const now = new Date();
      await transaction.appointment.update({
        where: { id: member.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          servingOrderKey: null,
          waitingPlacementType: null,
          activeAppointmentKey: null,
          cancelledAt: now,
          terminalAt: now,
          cancelledByType: AppointmentCancelledByType.PATIENT,
          cancellationReason: this.persistedReason(dto.reason, dto.note),
        },
      });

      const protectionEnded = await this.endProtectionIfRequired(
        transaction,
        group,
        now,
      );

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        group.practiceLocationId,
        group.serviceDate,
      );
      const event = await transaction.queueEvent.create({
        data: {
          practiceLocationId: group.practiceLocationId,
          serviceDate: group.serviceDate,
          queueEventSequence,
          type: QueueEventType.APPOINTMENT_CANCELLED,
          actorType: QueueEventActorType.PATIENT,
          actorUserId: null,
          previousPrimaryStatus: member.status,
          newPrimaryStatus: AppointmentStatus.CANCELLED,
          previousPrimaryOrderKey: member.servingOrderKey,
          newPrimaryOrderKey: null,
          previousPrimaryWaitingPlacementType:
            member.waitingPlacementType as never,
          newPrimaryWaitingPlacementType: null,
          previousPrimaryTerminalAt: member.terminalAt,
          newPrimaryTerminalAt: now,
          metadata: {
            bookingGroupId: group.id,
            controllerCancellation: true,
            groupProtectionEnded: protectionEnded,
          },
          createdAt: now,
        },
        select: { id: true },
      });

      await transaction.queueEventAppointmentLink.create({
        data: {
          queueEventId: event.id,
          role: QueueEventAppointmentLinkRole.PRIMARY,
          appointmentId: member.id,
        },
      });

      if (group.controllingMobileNumberEncrypted) {
        await transaction.notificationOutbox.create({
          data: {
            deliveryIdentityKey: this.hash(
              `${NotificationType.APPOINTMENT_CANCELLATION}|${event.id}|${member.id}`,
            ),
            notificationType: NotificationType.APPOINTMENT_CANCELLATION,
            channel: NotificationChannel.SMS,
            status: NotificationOutboxStatus.PENDING,
            practiceLocationId: group.practiceLocationId,
            appointmentId: member.id,
            bookingGroupId: group.id,
            recipientMobileEncrypted: group.controllingMobileNumberEncrypted,
            recipientEmailEncrypted: null,
            messageBodyEncrypted: this.notificationPayload.encryptMessage(
              'A member appointment in your booking group has been cancelled. Please review the group booking page for current status.',
            ),
            providerIdempotencyKey: `booking-group-member-cancel:${event.id}`,
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
          commandType: CommandType.BOOKING_GROUP_CANCEL_MEMBER,
          requestFingerprint,
          practiceLocationId: group.practiceLocationId,
          serviceDate: group.serviceDate,
          bookingGroupId: group.id,
          appointmentId: member.id,
          actorUserId: null,
          resultBookingGroupId: group.id,
          resultAppointmentId: member.id,
          resultQueueEventId: event.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      await transaction.bookingGroupAccessToken.update({
        where: { id: accessTokenId },
        data: { lastUsedAt: now },
      });

      return {
        replayed: false,
        bookingGroupId: group.id,
        appointmentId: member.id,
        queueEventId: event.id,
        status: AppointmentStatus.CANCELLED,
        groupProtectionEnded: protectionEnded,
      };
    });
  }

  private async assertControllerAccess(
    transaction: TransactionClient,
    bookingGroupId: string,
    tokenHash: string,
  ): Promise<string> {
    const now = new Date();
    const token = await transaction.bookingGroupAccessToken.findFirst({
      where: {
        bookingGroupId,
        tokenHash,
        purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!token) {
      throw new ForbiddenException(
        'BookingGroup controller access is invalid.',
      );
    }
    return token.id;
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
        "controllingMobileNumberEncrypted",
        "servingProtectionEndedAt"
      FROM "BookingGroup"
      WHERE "id" = ${bookingGroupId}
      LIMIT 1
      FOR UPDATE
    `);
    const group = rows[0];
    if (!group) throw new NotFoundException('BookingGroup was not found.');
    return group;
  }

  private async lockMember(
    transaction: TransactionClient,
    appointmentId: string,
  ): Promise<LockedMember> {
    const rows = await transaction.$queryRaw<LockedMember[]>(Prisma.sql`
      SELECT
        "id",
        "bookingGroupId",
        "practiceLocationId",
        "serviceDate",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "terminalAt",
        "calledAt"
      FROM "Appointment"
      WHERE "id" = ${appointmentId}
      LIMIT 1
      FOR UPDATE
    `);
    const member = rows[0];
    if (!member) throw new NotFoundException('Appointment was not found.');
    return member;
  }

  private async endProtectionIfRequired(
    transaction: TransactionClient,
    group: LockedGroup,
    now: Date,
  ): Promise<boolean> {
    if (group.servingProtectionEndedAt) return false;

    const members = await transaction.appointment.findMany({
      where: { bookingGroupId: group.id },
      select: {
        status: true,
        calledAt: true,
        servingOrderKey: true,
      },
    });

    const serviceBegun = members.some((item) => item.calledAt !== null);
    if (!serviceBegun) return false;

    const remainingProtected = members.filter(
      (item) =>
        item.status === AppointmentStatus.WAITING &&
        item.servingOrderKey !== null,
    );

    let shouldEnd = remainingProtected.length <= 1;
    if (!shouldEnd) {
      const firstWaiting = await transaction.appointment.findFirst({
        where: {
          practiceLocationId: group.practiceLocationId,
          serviceDate: group.serviceDate,
          status: AppointmentStatus.WAITING,
          servingOrderKey: { not: null },
        },
        orderBy: { servingOrderKey: 'asc' },
        select: { bookingGroupId: true },
      });
      shouldEnd = Boolean(
        firstWaiting && firstWaiting.bookingGroupId !== group.id,
      );
    }

    if (!shouldEnd) return false;
    await transaction.bookingGroup.update({
      where: { id: group.id },
      data: { servingProtectionEndedAt: now },
    });
    return true;
  }

  private async readReplayResult(
    transaction: TransactionClient,
    bookingGroupId: string | null,
    appointmentId: string | null,
    queueEventId: string | null,
  ) {
    if (!bookingGroupId || !appointmentId || !queueEventId) {
      throw new ConflictException(
        'BookingGroup cancellation replay record is incomplete.',
      );
    }
    const [group, appointment, event] = await Promise.all([
      transaction.bookingGroup.findUnique({
        where: { id: bookingGroupId },
        select: { id: true, servingProtectionEndedAt: true },
      }),
      transaction.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, bookingGroupId: true, status: true },
      }),
      transaction.queueEvent.findUnique({
        where: { id: queueEventId },
        select: { id: true, type: true },
      }),
    ]);
    if (
      !group ||
      !appointment ||
      appointment.bookingGroupId !== group.id ||
      !event ||
      event.type !== QueueEventType.APPOINTMENT_CANCELLED
    ) {
      throw new ConflictException(
        'BookingGroup cancellation replay result is inconsistent.',
      );
    }
    return {
      replayed: true,
      bookingGroupId: group.id,
      appointmentId: appointment.id,
      queueEventId: event.id,
      status: appointment.status,
      groupProtectionEnded: group.servingProtectionEndedAt !== null,
    };
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
    reason: BookingGroupMemberCancellationReason,
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
    const lockIdentity = `queue|${practiceLocationId}|${serviceDate.toISOString().slice(0, 10)}`;
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

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
