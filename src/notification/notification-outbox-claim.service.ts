import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  SecretaryInvitationStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ClaimedOutboxRow = {
  id: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  recipientMobileEncrypted: string | null;
  recipientEmailEncrypted: string | null;
  messageBodyEncrypted: string | null;
  providerIdempotencyKey: string;
  attemptCount: number;
  processingStartedAt: Date;
  leaseExpiresAt: Date;
  processingWorkerId: string;
};

@Injectable()
export class NotificationOutboxClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claimNext(
    workerId: string,
    leaseDurationMs: number,
    now = new Date(),
  ): Promise<ClaimedOutboxRow | null> {
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
          SELECT no."id"
          FROM "NotificationOutbox" no
          WHERE no."status" = ${NotificationOutboxStatus.PENDING}::"NotificationOutboxStatus"
            AND no."nextAttemptAt" <= ${now}
            AND no."cancelledAt" IS NULL
            AND no."sentAt" IS NULL
            AND no."failedAt" IS NULL
            AND no."expiresAt" > ${now}
            AND (
              no."notificationType" <> ${NotificationType.SECRETARY_INVITATION}::"NotificationType"
              OR EXISTS (
                SELECT 1
                FROM "SecretaryInvitation" si
                WHERE si."id" = no."secretaryInvitationId"
                  AND si."status" = ${SecretaryInvitationStatus.PENDING}::"SecretaryInvitationStatus"
                  AND si."tokenHash" IS NOT NULL
                  AND si."activeInvitationKey" IS NOT NULL
                  AND si."expiresAt" > ${now}
              )
            )
          ORDER BY no."nextAttemptAt" ASC, no."createdAt" ASC, no."id" ASC
          LIMIT 1
          FOR UPDATE OF no SKIP LOCKED
        `,
      );

      const candidate = candidates[0];
      if (!candidate) return null;

      const claimed = await transaction.notificationOutbox.update({
        where: { id: candidate.id },
        data: {
          status: NotificationOutboxStatus.PROCESSING,
          processingStartedAt: now,
          leaseExpiresAt,
          processingWorkerId: normalizedWorkerId,
        },
        select: {
          id: true,
          notificationType: true,
          channel: true,
          recipientMobileEncrypted: true,
          recipientEmailEncrypted: true,
          messageBodyEncrypted: true,
          providerIdempotencyKey: true,
          attemptCount: true,
        },
      });

      return {
        ...claimed,
        processingStartedAt: now,
        leaseExpiresAt,
        processingWorkerId: normalizedWorkerId,
      };
    });
  }
}
