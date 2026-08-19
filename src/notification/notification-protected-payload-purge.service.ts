import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GENERAL_PROTECTED_PAYLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PURGE_BATCH_SIZE = 100;
const MAX_PURGE_BATCH_SIZE = 500;

export type NotificationProtectedPayloadPurgeResult = {
  purgedCount: number;
};

@Injectable()
export class NotificationProtectedPayloadPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async purgeEligible(
    now = new Date(),
    batchSize = DEFAULT_PURGE_BATCH_SIZE,
  ): Promise<NotificationProtectedPayloadPurgeResult> {
    if (
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > MAX_PURGE_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Notification protected-payload purge batch size is invalid.',
      );
    }

    const terminalCutoff = new Date(
      now.getTime() - GENERAL_PROTECTED_PAYLOAD_RETENTION_MS,
    );

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "NotificationOutbox"
          WHERE "protectedPayloadPurgedAt" IS NULL
            AND "notificationType" <> ${NotificationType.OTP_VERIFICATION}::"NotificationType"
            AND (
              (
                "status" = ${NotificationOutboxStatus.SENT}::"NotificationOutboxStatus"
                AND "sentAt" <= ${terminalCutoff}
              )
              OR (
                "status" = ${NotificationOutboxStatus.FAILED}::"NotificationOutboxStatus"
                AND "failedAt" <= ${terminalCutoff}
              )
              OR (
                "status" = ${NotificationOutboxStatus.CANCELLED}::"NotificationOutboxStatus"
                AND "cancelledAt" <= ${terminalCutoff}
              )
            )
          ORDER BY COALESCE("sentAt", "failedAt", "cancelledAt") ASC, "id" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `,
      );

      if (candidates.length === 0) {
        return { purgedCount: 0 };
      }

      const ids = candidates.map((candidate) => candidate.id);
      const purged = await transaction.notificationOutbox.updateMany({
        where: {
          id: { in: ids },
          protectedPayloadPurgedAt: null,
        },
        data: {
          recipientMobileEncrypted: null,
          recipientEmailEncrypted: null,
          messageBodyEncrypted: null,
          protectedPayloadPurgedAt: now,
        },
      });

      return { purgedCount: purged.count };
    });
  }
}
