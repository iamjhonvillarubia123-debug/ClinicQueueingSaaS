import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OTP_PURGE_MAX_DELAY_MS = 15 * 60 * 1000;
const MAX_BATCH_SIZE = 100;

@Injectable()
export class NotificationOtpPayloadPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async purgeEligible(
    batchSize = 50,
    now = new Date(),
  ): Promise<{ purgedCount: number }> {
    if (
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Notification OTP payload purge batch size is invalid.',
      );
    }

    const unusableCutoff = new Date(now.getTime() - OTP_PURGE_MAX_DELAY_MS);

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT no."id"
          FROM "NotificationOutbox" no
          INNER JOIN "OtpVerification" ov
            ON ov."id" = no."otpVerificationId"
          WHERE no."notificationType" = ${NotificationType.OTP_VERIFICATION}::"NotificationType"
            AND no."protectedPayloadPurgedAt" IS NULL
            AND (
              no."recipientMobileEncrypted" IS NOT NULL
              OR no."recipientEmailEncrypted" IS NOT NULL
              OR no."messageBodyEncrypted" IS NOT NULL
            )
            AND (
              no."status" IN (
                ${NotificationOutboxStatus.SENT}::"NotificationOutboxStatus",
                ${NotificationOutboxStatus.FAILED}::"NotificationOutboxStatus",
                ${NotificationOutboxStatus.CANCELLED}::"NotificationOutboxStatus"
              )
              OR LEAST(
                ov."expiresAt",
                COALESCE(ov."consumedAt", 'infinity'::timestamptz),
                COALESCE(ov."invalidatedAt", 'infinity'::timestamptz)
              ) <= ${unusableCutoff}
            )
          ORDER BY no."createdAt" ASC, no."id" ASC
          LIMIT ${batchSize}
          FOR UPDATE OF no SKIP LOCKED
        `,
      );

      if (candidates.length === 0) {
        return { purgedCount: 0 };
      }

      const ids = candidates.map(({ id }) => id);
      const updated = await transaction.notificationOutbox.updateMany({
        where: {
          id: { in: ids },
          notificationType: NotificationType.OTP_VERIFICATION,
          protectedPayloadPurgedAt: null,
        },
        data: {
          recipientMobileEncrypted: null,
          recipientEmailEncrypted: null,
          messageBodyEncrypted: null,
          protectedPayloadPurgedAt: now,
        },
      });

      return { purgedCount: updated.count };
    });
  }
}
