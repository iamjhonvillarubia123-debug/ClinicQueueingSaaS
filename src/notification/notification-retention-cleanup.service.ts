import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const TERMINAL_OUTBOX_STATUSES = [
  NotificationOutboxStatus.SENT,
  NotificationOutboxStatus.FAILED,
  NotificationOutboxStatus.CANCELLED,
] as const;

export type NotificationRetentionCleanupResult = {
  examinedOutboxes: number;
  deletedLogs: number;
  deletedOutboxes: number;
  deferredOutboxes: number;
};

@Injectable()
export class NotificationRetentionCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanupEligible(
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<NotificationRetentionCleanupResult> {
    if (
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Notification cleanup batch size is invalid.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "NotificationOutbox"
          WHERE "status" IN ('SENT', 'FAILED', 'CANCELLED')
            AND "expiresAt" <= ${now}
          ORDER BY "expiresAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        `,
      );

      let deletedLogs = 0;
      let deletedOutboxes = 0;
      let deferredOutboxes = 0;

      for (const candidate of candidates) {
        const retainedLogCount = await transaction.notificationLog.count({
          where: {
            notificationOutboxId: candidate.id,
            expiresAt: { gt: now },
          },
        });

        if (retainedLogCount > 0) {
          deferredOutboxes += 1;
          continue;
        }

        const logDeletion = await transaction.notificationLog.deleteMany({
          where: {
            notificationOutboxId: candidate.id,
            expiresAt: { lte: now },
          },
        });
        deletedLogs += logDeletion.count;

        const outboxDeletion = await transaction.notificationOutbox.deleteMany({
          where: {
            id: candidate.id,
            status: { in: [...TERMINAL_OUTBOX_STATUSES] },
            expiresAt: { lte: now },
            notificationLogs: { none: {} },
          },
        });

        if (outboxDeletion.count === 1) {
          deletedOutboxes += 1;
        } else {
          deferredOutboxes += 1;
        }
      }

      return {
        examinedOutboxes: candidates.length,
        deletedLogs,
        deletedOutboxes,
        deferredOutboxes,
      };
    });
  }
}
