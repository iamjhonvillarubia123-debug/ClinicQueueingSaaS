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

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_MS = 30 * DAY_MS;

export type ProviderAttemptResult = {
  outcome: NotificationAttemptOutcome;
  providerName?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  failureDetailSanitized?: string | null;
  submittedAt: Date;
  resolvedAt?: Date | null;
  nextAttemptAt?: Date | null;
};

export type FinalizedAttempt = {
  notificationLogId: string;
  attemptNumber: number;
  outboxStatus: NotificationOutboxStatus;
};

@Injectable()
export class NotificationDeliveryAttemptService {
  constructor(private readonly prisma: PrismaService) {}

  async finalizeAttempt(
    outboxId: string,
    workerId: string,
    result: ProviderAttemptResult,
    now = new Date(),
  ): Promise<FinalizedAttempt> {
    return this.finalizeInternal(outboxId, workerId, null, result, now);
  }

  async finalizeReservedAttempt(
    outboxId: string,
    workerId: string,
    attemptNumber: number,
    result: ProviderAttemptResult,
    now = new Date(),
  ): Promise<FinalizedAttempt> {
    if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
      throw new BadRequestException(
        'Reserved notification attempt number is invalid.',
      );
    }

    return this.finalizeInternal(
      outboxId,
      workerId,
      attemptNumber,
      result,
      now,
    );
  }

  private async finalizeInternal(
    outboxId: string,
    workerId: string,
    reservedAttemptNumber: number | null,
    result: ProviderAttemptResult,
    now: Date,
  ): Promise<FinalizedAttempt> {
    const normalizedWorkerId = workerId.trim();
    if (!outboxId.trim() || !normalizedWorkerId) {
      throw new BadRequestException(
        'Notification attempt identity is invalid.',
      );
    }

    if (
      result.outcome === NotificationAttemptOutcome.RETRYABLE_FAILURE &&
      (!result.nextAttemptAt || result.nextAttemptAt.getTime() <= now.getTime())
    ) {
      throw new BadRequestException(
        'Retryable notification failure requires a future retry time.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          notificationType: NotificationType;
          channel: NotificationChannel;
          status: NotificationOutboxStatus;
          scheduledReminderId: string | null;
          attemptCount: number;
          processingWorkerId: string | null;
          leaseExpiresAt: Date | null;
          providerIdempotencyKey: string;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "notificationType",
            "channel",
            "status",
            "scheduledReminderId",
            "attemptCount",
            "processingWorkerId",
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
          'Notification worker does not own an active processing lease.',
        );
      }

      const attemptNumber = reservedAttemptNumber ?? outbox.attemptCount + 1;
      if (
        reservedAttemptNumber !== null &&
        outbox.attemptCount !== reservedAttemptNumber
      ) {
        throw new BadRequestException(
          'Reserved notification attempt does not match the outbox state.',
        );
      }

      const resolvedAt =
        result.outcome === NotificationAttemptOutcome.UNCERTAIN
          ? null
          : (result.resolvedAt ?? now);
      const retentionAnchor = resolvedAt ?? now;
      const retryRecommended =
        result.outcome === NotificationAttemptOutcome.RETRYABLE_FAILURE;

      const log = await transaction.notificationLog.create({
        data: {
          notificationOutboxId: outbox.id,
          attemptNumber,
          notificationType: outbox.notificationType,
          channel: outbox.channel,
          outcome: result.outcome,
          providerName: result.providerName ?? null,
          providerReference: result.providerReference ?? null,
          providerStatus: result.providerStatus ?? null,
          providerErrorCode: result.providerErrorCode ?? null,
          failureDetailSanitized: result.failureDetailSanitized ?? null,
          retryRecommended,
          providerIdempotencyKeyUsed: outbox.providerIdempotencyKey,
          submittedAt: result.submittedAt,
          resolvedAt,
          expiresAt: new Date(retentionAnchor.getTime() + LOG_RETENTION_MS),
        },
      });

      const update = this.outboxTransition(result, now);
      const updated = await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          ...update,
          attemptCount: attemptNumber,
        },
        select: { status: true },
      });

      await this.synchronizeScheduledReminder(
        transaction,
        outbox.notificationType,
        outbox.scheduledReminderId,
        result,
        now,
      );

      return {
        notificationLogId: log.id,
        attemptNumber,
        outboxStatus: updated.status,
      };
    });
  }

  private async synchronizeScheduledReminder(
    transaction: Prisma.TransactionClient,
    notificationType: NotificationType,
    scheduledReminderId: string | null,
    result: ProviderAttemptResult,
    now: Date,
  ): Promise<void> {
    if (notificationType !== NotificationType.SCHEDULED_REMINDER) return;

    if (!scheduledReminderId) {
      throw new BadRequestException(
        'Scheduled reminder notification is missing its source reminder.',
      );
    }

    let synchronizedCount: number;

    switch (result.outcome) {
      case NotificationAttemptOutcome.SUCCESS:
        synchronizedCount = (
          await transaction.scheduledReminder.updateMany({
            where: {
              id: scheduledReminderId,
              status: ScheduledReminderStatus.PROCESSING,
            },
            data: {
              status: ScheduledReminderStatus.SENT,
              sentAt: now,
            },
          })
        ).count;
        break;
      case NotificationAttemptOutcome.PERMANENT_FAILURE:
        synchronizedCount = (
          await transaction.scheduledReminder.updateMany({
            where: {
              id: scheduledReminderId,
              status: ScheduledReminderStatus.PROCESSING,
            },
            data: {
              status: ScheduledReminderStatus.FAILED,
              failedAt: now,
            },
          })
        ).count;
        break;
      case NotificationAttemptOutcome.RETRYABLE_FAILURE:
      case NotificationAttemptOutcome.UNCERTAIN:
        return;
    }

    if (synchronizedCount !== 1) {
      throw new BadRequestException(
        'Scheduled reminder delivery state is inconsistent with its outbox.',
      );
    }
  }

  private outboxTransition(
    result: ProviderAttemptResult,
    now: Date,
  ): Prisma.NotificationOutboxUpdateInput {
    const clearLease = {
      processingStartedAt: null,
      leaseExpiresAt: null,
      processingWorkerId: null,
    };

    switch (result.outcome) {
      case NotificationAttemptOutcome.SUCCESS:
        return {
          status: NotificationOutboxStatus.SENT,
          sentAt: now,
          ...clearLease,
        };
      case NotificationAttemptOutcome.RETRYABLE_FAILURE:
        if (!result.nextAttemptAt) {
          throw new BadRequestException(
            'Retryable notification failure requires a future retry time.',
          );
        }
        return {
          status: NotificationOutboxStatus.PENDING,
          nextAttemptAt: result.nextAttemptAt,
          ...clearLease,
        };
      case NotificationAttemptOutcome.PERMANENT_FAILURE:
        return {
          status: NotificationOutboxStatus.FAILED,
          failedAt: now,
          ...clearLease,
        };
      case NotificationAttemptOutcome.UNCERTAIN:
        return {
          status: NotificationOutboxStatus.PROCESSING,
        };
    }
  }
}
