import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationProviderReconciliationOutcome,
  NotificationProviderReconciliationResult,
} from './notification-provider-adapter';

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
          processingStartedAt: now,
          leaseExpiresAt,
          processingWorkerId: normalizedWorkerId,
        },
        select: {
          id: true,
          notificationType: true,
          channel: true,
          providerIdempotencyKey: true,
        },
      });

      return {
        ...outbox,
        providerName: latestUncertain?.providerName ?? null,
        providerReference: latestUncertain?.providerReference ?? null,
        providerStatus: latestUncertain?.providerStatus ?? null,
        latestAttemptNumber: latestUncertain?.attemptNumber ?? null,
        processingStartedAt: now,
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
          status: NotificationOutboxStatus;
          attemptCount: number;
          processingWorkerId: string | null;
          leaseExpiresAt: Date | null;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "status",
            "attemptCount",
            "processingWorkerId",
            "leaseExpiresAt"
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

      const update = this.reconciliationTransition(result, now);
      const updated = await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: update,
        select: { status: true },
      });

      return { outboxStatus: updated.status };
    });
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
