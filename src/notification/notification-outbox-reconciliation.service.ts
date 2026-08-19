import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationProviderReconciliationOutcome,
  NotificationProviderReconciliationResult,
} from './notification-provider-adapter';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_MS = 30 * DAY_MS;

type ReconciliationCandidate = {
  id: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  providerIdempotencyKey: string;
  providerName: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  latestAttemptNumber: number | null;
  processingStartedAt: Date;
  leaseExpiresAt: Date;
  processingWorkerId: string;
};

type ReconciliationApplied = {
  outboxStatus: NotificationOutboxStatus;
};

@Injectable()
export class NotificationOutboxReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async claimExpiredForReconciliation(
    workerId: string,
    leaseDurationMs: number,
    now = new Date(),
  ): Promise<ReconciliationCandidate | null> {
    const normalizedWorkerId = workerId.trim();
    if (!normalizedWorkerId || normalizedWorkerId.length > 100) {
      throw new BadRequestException('Notification worker identity is invalid.');
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new BadRequestException('Notification worker lease is invalid.');
    }

    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "NotificationOutbox"
          WHERE "status" = ${NotificationOutboxStatus.PROCESSING}::"NotificationOutboxStatus"
            AND "leaseExpiresAt" < ${now}
            AND "cancelledAt" IS NULL
            AND "sentAt" IS NULL
            AND "failedAt" IS NULL
          ORDER BY "leaseExpiresAt" ASC, "createdAt" ASC, "id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
      );

      const candidate = candidates[0];
      if (!candidate) return null;

      const latestUncertain = await transaction.notificationLog.findFirst({
        where: {
          notificationOutboxId: candidate.id,
          outcome: NotificationAttemptOutcome.UNCERTAIN,
        },
        orderBy: { attemptNumber: 'desc' },
        select: {
          attemptNumber: true,
          providerName: true,
          providerReference: true,
          providerStatus: true,
        },
      });

      const outbox = await transaction.notificationOutbox.update({
        where: { id: candidate.id },
        data: {
          leaseExpiresAt,
          processingWorkerId: normalizedWorkerId,
        },
        select: {
          id: true,
          notificationType: true,
          channel: true,
          providerIdempotencyKey: true,
          processingStartedAt: true,
        },
      });
      if (!outbox.processingStartedAt) {
        throw new BadRequestException(
          'Notification reconciliation is missing its original processing start.',
        );
      }

      return {
        id: outbox.id,
        notificationType: outbox.notificationType,
        channel: outbox.channel,
        providerIdempotencyKey: outbox.providerIdempotencyKey,
        providerName: latestUncertain?.providerName ?? null,
        providerReference: latestUncertain?.providerReference ?? null,
        providerStatus: latestUncertain?.providerStatus ?? null,
        latestAttemptNumber: latestUncertain?.attemptNumber ?? null,
        processingStartedAt: outbox.processingStartedAt,
        leaseExpiresAt,
        processingWorkerId: normalizedWorkerId,
      };
    });
  }

  async applyReconciliation(
    outboxId: string,
    workerId: string,
    result: NotificationProviderReconciliationResult,
    now = new Date(),
  ): Promise<ReconciliationApplied> {
    const normalizedWorkerId = workerId.trim();
    if (!outboxId.trim() || !normalizedWorkerId) {
      throw new BadRequestException(
        'Notification reconciliation identity is invalid.',
      );
    }
    if (
      result.outcome ===
        NotificationProviderReconciliationOutcome.RETRY_SAFE_NOT_ACCEPTED &&
      (!result.nextAttemptAt || result.nextAttemptAt.getTime() <= now.getTime())
    ) {
      throw new BadRequestException(
        'Safe notification retry requires a future retry time.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          notificationType: NotificationType;
          channel: NotificationChannel;
          scheduledReminderId: string | null;
          status: NotificationOutboxStatus;
          attemptCount: number;
          processingWorkerId: string | null;
          processingStartedAt: Date | null;
          leaseExpiresAt: Date | null;
          providerIdempotencyKey: string;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "notificationType",
            "channel",
            "scheduledReminderId",
            "status",
            "attemptCount",
            "processingWorkerId",
            "processingStartedAt",
            "leaseExpiresAt",
            "providerIdempotencyKey"
          FROM "NotificationOutbox"
          WHERE "id" = ${outboxId}
          FOR UPDATE
        `,
      );

      const outbox = rows[0];
      if (!outbox) {
        throw new BadRequestException('Notification outbox was not found.');
      }
      if (
        outbox.status !== NotificationOutboxStatus.PROCESSING ||
        outbox.processingWorkerId !== normalizedWorkerId ||
        !outbox.leaseExpiresAt ||
        outbox.leaseExpiresAt.getTime() < now.getTime()
      ) {
        throw new BadRequestException(
          'Notification worker does not own an active reconciliation lease.',
        );
      }

      const latestLog = await transaction.notificationLog.findFirst({
        where: { notificationOutboxId: outbox.id },
        orderBy: { attemptNumber: 'desc' },
        select: { attemptNumber: true },
      });
      const latestRecordedAttempt = latestLog?.attemptNumber ?? 0;
      if (
        outbox.attemptCount < latestRecordedAttempt ||
        outbox.attemptCount > latestRecordedAttempt + 1
      ) {
        throw new BadRequestException(
          'Notification attempt history is inconsistent with its outbox.',
        );
      }

      const hasReservedGap = outbox.attemptCount === latestRecordedAttempt + 1;
      if (
        hasReservedGap &&
        (result.outcome ===
          NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS ||
          result.outcome ===
            NotificationProviderReconciliationOutcome.CONFIRMED_PERMANENT_FAILURE)
      ) {
        const terminalOutcome =
          result.outcome ===
          NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS
            ? NotificationAttemptOutcome.SUCCESS
            : NotificationAttemptOutcome.PERMANENT_FAILURE;
        const resolvedAt = result.providerConfirmedAt ?? now;

        await transaction.notificationLog.create({
          data: {
            notificationOutboxId: outbox.id,
            attemptNumber: outbox.attemptCount,
            notificationType: outbox.notificationType,
            channel: outbox.channel,
            outcome: terminalOutcome,
            providerStatus:
              terminalOutcome === NotificationAttemptOutcome.SUCCESS
                ? 'reconciled-confirmed-success'
                : 'reconciled-confirmed-permanent-failure',
            retryRecommended: false,
            providerIdempotencyKeyUsed: outbox.providerIdempotencyKey,
            submittedAt: outbox.processingStartedAt ?? now,
            resolvedAt,
            expiresAt: new Date(resolvedAt.getTime() + LOG_RETENTION_MS),
          },
        });
      }

      const update = this.reconciliationTransition(result, now);
      const updated = await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: update,
        select: { status: true },
      });

      await this.synchronizeScheduledReminder(
        transaction,
        outbox.notificationType,
        outbox.scheduledReminderId,
        result,
        now,
      );

      return { outboxStatus: updated.status };
    });
  }

  private async synchronizeScheduledReminder(
    transaction: Prisma.TransactionClient,
    notificationType: NotificationType,
    scheduledReminderId: string | null,
    result: NotificationProviderReconciliationResult,
    now: Date,
  ): Promise<void> {
    if (notificationType !== NotificationType.SCHEDULED_REMINDER) return;
    if (!scheduledReminderId) {
      throw new BadRequestException(
        'Scheduled reminder notification is missing its source reminder.',
      );
    }

    if (
      result.outcome ===
        NotificationProviderReconciliationOutcome.RETRY_SAFE_NOT_ACCEPTED ||
      result.outcome ===
        NotificationProviderReconciliationOutcome.STILL_UNCERTAIN
    ) {
      return;
    }

    const status =
      result.outcome ===
      NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS
        ? ScheduledReminderStatus.SENT
        : ScheduledReminderStatus.FAILED;
    const update =
      status === ScheduledReminderStatus.SENT
        ? { status, sentAt: result.providerConfirmedAt ?? now }
        : { status, failedAt: result.providerConfirmedAt ?? now };

    const synchronized = await transaction.scheduledReminder.updateMany({
      where: {
        id: scheduledReminderId,
        status: ScheduledReminderStatus.PROCESSING,
      },
      data: update,
    });
    if (synchronized.count !== 1) {
      throw new BadRequestException(
        'Scheduled reminder reconciliation state is inconsistent with its outbox.',
      );
    }
  }

  private reconciliationTransition(
    result: NotificationProviderReconciliationResult,
    now: Date,
  ): Prisma.NotificationOutboxUpdateInput {
    const clearLease = {
      processingStartedAt: null,
      leaseExpiresAt: null,
      processingWorkerId: null,
    };

    switch (result.outcome) {
      case NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS:
        return {
          status: NotificationOutboxStatus.SENT,
          sentAt: result.providerConfirmedAt ?? now,
          ...clearLease,
        };
      case NotificationProviderReconciliationOutcome.RETRY_SAFE_NOT_ACCEPTED:
        if (!result.nextAttemptAt) {
          throw new BadRequestException(
            'Safe notification retry requires a future retry time.',
          );
        }
        return {
          status: NotificationOutboxStatus.PENDING,
          nextAttemptAt: result.nextAttemptAt,
          ...clearLease,
        };
      case NotificationProviderReconciliationOutcome.CONFIRMED_PERMANENT_FAILURE:
        return {
          status: NotificationOutboxStatus.FAILED,
          failedAt: result.providerConfirmedAt ?? now,
          ...clearLease,
        };
      case NotificationProviderReconciliationOutcome.STILL_UNCERTAIN:
        return {
          status: NotificationOutboxStatus.PROCESSING,
        };
    }
  }
}
