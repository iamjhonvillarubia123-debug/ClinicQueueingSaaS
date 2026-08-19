import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationSubmissionBoundaryResult =
  | {
      disposition: 'RESERVED';
      attemptNumber: number;
    }
  | {
      disposition: 'CANCELLED';
      outboxStatus: NotificationOutboxStatus;
    };

@Injectable()
export class NotificationSubmissionBoundaryService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveAttempt(
    outboxId: string,
    workerId: string,
    now = new Date(),
  ): Promise<NotificationSubmissionBoundaryResult> {
    const normalizedOutboxId = outboxId.trim();
    const normalizedWorkerId = workerId.trim();
    if (!normalizedOutboxId || !normalizedWorkerId) {
      throw new BadRequestException(
        'Notification submission identity is invalid.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          notificationType: NotificationType;
          status: NotificationOutboxStatus;
          otpVerificationId: string | null;
          attemptCount: number;
          processingWorkerId: string | null;
          leaseExpiresAt: Date | null;
        }>
      >(
        Prisma.sql`
          SELECT
            "id",
            "notificationType",
            "status",
            "otpVerificationId",
            "attemptCount",
            "processingWorkerId",
            "leaseExpiresAt"
          FROM "NotificationOutbox"
          WHERE "id" = ${normalizedOutboxId}
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

      if (outbox.attemptCount === latestRecordedAttempt + 1) {
        return {
          disposition: 'RESERVED',
          attemptNumber: outbox.attemptCount,
        };
      }

      if (outbox.notificationType === NotificationType.OTP_VERIFICATION) {
        if (!outbox.otpVerificationId) {
          throw new BadRequestException(
            'OTP notification is missing its verification context.',
          );
        }

        const otpRows = await transaction.$queryRaw<
          Array<{
            id: string;
            expiresAt: Date;
            consumedAt: Date | null;
            invalidatedAt: Date | null;
          }>
        >(
          Prisma.sql`
            SELECT
              "id",
              "expiresAt",
              "consumedAt",
              "invalidatedAt"
            FROM "OtpVerification"
            WHERE "id" = ${outbox.otpVerificationId}
            FOR UPDATE
          `,
        );
        const otp = otpRows[0];
        if (!otp) {
          throw new BadRequestException(
            'OTP notification verification context was not found.',
          );
        }

        const isStale =
          otp.expiresAt.getTime() <= now.getTime() ||
          otp.consumedAt !== null ||
          otp.invalidatedAt !== null;

        if (isStale) {
          await transaction.notificationOutbox.update({
            where: { id: outbox.id },
            data: {
              status: NotificationOutboxStatus.CANCELLED,
              cancelledAt: now,
              processingStartedAt: null,
              leaseExpiresAt: null,
              processingWorkerId: null,
              recipientMobileEncrypted: null,
              recipientEmailEncrypted: null,
              messageBodyEncrypted: null,
              protectedPayloadPurgedAt: now,
            },
          });

          return {
            disposition: 'CANCELLED',
            outboxStatus: NotificationOutboxStatus.CANCELLED,
          };
        }
      }

      const attemptNumber = latestRecordedAttempt + 1;
      await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: { attemptCount: attemptNumber },
      });

      return { disposition: 'RESERVED', attemptNumber };
    });
  }
}
