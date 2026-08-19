import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ReservedNotificationAttempt = {
  attemptNumber: number;
};

@Injectable()
export class NotificationSubmissionBoundaryService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveAttempt(
    outboxId: string,
    workerId: string,
    now = new Date(),
  ): Promise<ReservedNotificationAttempt> {
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
        return { attemptNumber: outbox.attemptCount };
      }

      const attemptNumber = latestRecordedAttempt + 1;
      await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: { attemptCount: attemptNumber },
      });

      return { attemptNumber };
    });
  }
}
