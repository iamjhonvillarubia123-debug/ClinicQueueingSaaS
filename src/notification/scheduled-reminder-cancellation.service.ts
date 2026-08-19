import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ScheduledReminderCancellationResult = {
  reminderStatus: ScheduledReminderStatus;
  outboxStatus: NotificationOutboxStatus | null;
  reconciliationRequired: boolean;
};

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class ScheduledReminderCancellationService {
  constructor(private readonly prisma: PrismaService) {}

  async cancelSafely(
    scheduledReminderId: string,
    now = new Date(),
  ): Promise<ScheduledReminderCancellationResult> {
    return this.prisma.$transaction((transaction) =>
      this.cancelSafelyInTransaction(transaction, scheduledReminderId, now),
    );
  }

  async cancelSafelyInTransaction(
    transaction: TransactionClient,
    scheduledReminderId: string,
    now = new Date(),
  ): Promise<ScheduledReminderCancellationResult> {
    const reminderId = scheduledReminderId.trim();
    if (!reminderId) {
      throw new BadRequestException('Scheduled reminder identity is invalid.');
    }

    const outboxRows = await transaction.$queryRaw<
      Array<{
        id: string;
        notificationType: NotificationType;
        status: NotificationOutboxStatus;
        scheduledReminderId: string | null;
        attemptCount: number;
      }>
    >(
      Prisma.sql`
        SELECT
          "id",
          "notificationType",
          "status",
          "scheduledReminderId",
          "attemptCount"
        FROM "NotificationOutbox"
        WHERE "scheduledReminderId" = ${reminderId}
        FOR UPDATE
      `,
    );

    const reminderRows = await transaction.$queryRaw<
      Array<{
        id: string;
        status: ScheduledReminderStatus;
      }>
    >(
      Prisma.sql`
        SELECT "id", "status"
        FROM "ScheduledReminder"
        WHERE "id" = ${reminderId}
        FOR UPDATE
      `,
    );

    const reminder = reminderRows[0];
    if (!reminder) {
      throw new BadRequestException('Scheduled reminder was not found.');
    }

    const outbox = outboxRows[0] ?? null;

    if (!outbox) {
      if (reminder.status === ScheduledReminderStatus.CANCELLED) {
        return {
          reminderStatus: reminder.status,
          outboxStatus: null,
          reconciliationRequired: false,
        };
      }
      if (reminder.status !== ScheduledReminderStatus.SCHEDULED) {
        throw new BadRequestException(
          'Scheduled reminder cannot be cancelled in its current state.',
        );
      }

      await transaction.scheduledReminder.update({
        where: { id: reminder.id },
        data: {
          status: ScheduledReminderStatus.CANCELLED,
          cancelledAt: now,
        },
      });

      return {
        reminderStatus: ScheduledReminderStatus.CANCELLED,
        outboxStatus: null,
        reconciliationRequired: false,
      };
    }

    if (
      outbox.notificationType !== NotificationType.SCHEDULED_REMINDER ||
      outbox.scheduledReminderId !== reminder.id
    ) {
      throw new BadRequestException(
        'Scheduled reminder delivery relation is inconsistent.',
      );
    }

    if (
      reminder.status === ScheduledReminderStatus.CANCELLED &&
      outbox.status === NotificationOutboxStatus.CANCELLED
    ) {
      return {
        reminderStatus: reminder.status,
        outboxStatus: outbox.status,
        reconciliationRequired: false,
      };
    }

    if (
      reminder.status === ScheduledReminderStatus.SENT ||
      outbox.status === NotificationOutboxStatus.SENT
    ) {
      throw new BadRequestException('A sent scheduled reminder cannot be cancelled.');
    }

    if (reminder.status !== ScheduledReminderStatus.PROCESSING) {
      throw new BadRequestException(
        'Scheduled reminder cannot be cancelled in its current delivery state.',
      );
    }

    if (outbox.status === NotificationOutboxStatus.PROCESSING) {
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

      if (outbox.attemptCount > latestRecordedAttempt) {
        return {
          reminderStatus: reminder.status,
          outboxStatus: outbox.status,
          reconciliationRequired: true,
        };
      }
    } else if (outbox.status !== NotificationOutboxStatus.PENDING) {
      throw new BadRequestException(
        'Scheduled reminder cannot be cancelled in its current delivery state.',
      );
    }

    await transaction.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: now,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
      },
    });

    await transaction.scheduledReminder.update({
      where: { id: reminder.id },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });

    return {
      reminderStatus: ScheduledReminderStatus.CANCELLED,
      outboxStatus: NotificationOutboxStatus.CANCELLED,
      reconciliationRequired: false,
    };
  }
}
