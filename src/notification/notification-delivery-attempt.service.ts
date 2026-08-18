import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationOutboxStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_RETENTION_MS = 30 * DAY_MS;

type ProviderAttemptResult = {
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

type FinalizedAttempt = {
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
    const normalizedWorkerId = workerId.trim();
    if (!outboxId.trim() || !normalizedWorkerId) {
      throw new BadRequestException('Notification attempt identity is invalid.');
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
          notificationType: string;
          channel: string;
          status: NotificationOutboxStatus;
          attemptCount: number;
          processingWorkerId: string | null;
          leaseExpiresAt: Date | null;
          providerIdempotencyKey: string;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "notificationType"::text,
            "channel"::text,
            "status",
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

      const attemptNumber = outbox.attemptCount + 1;
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

      const update = this.outboxTransition(result.outcome, result.nextAttemptAt, now);
      const updated = await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          ...update,
          attemptCount: attemptNumber,
        },
        select: { status: true },
      });

      return {
        notificationLogId: log.id,
        attemptNumber,
        outboxStatus: updated.status,
      };
    });
  }

  private outboxTransition(
    outcome: NotificationAttemptOutcome,
    nextAttemptAt: Date | null | undefined,
    now: Date,
  ): Prisma.NotificationOutboxUpdateInput {
    const clearLease = {
      processingStartedAt: null,
      leaseExpiresAt: null,
      processingWorkerId: null,
    };

    switch (outcome) {
      case NotificationAttemptOutcome.SUCCESS:
        return {
          status: NotificationOutboxStatus.SENT,
          sentAt: now,
          ...clearLease,
        };
      case NotificationAttemptOutcome.RETRYABLE_FAILURE:
        return {
          status: NotificationOutboxStatus.PENDING,
          nextAttemptAt: nextAttemptAt!,
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
