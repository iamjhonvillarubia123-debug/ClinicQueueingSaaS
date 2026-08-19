import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPayloadService } from './notification-payload.service';

type TransactionClient = Prisma.TransactionClient;

type LockedScheduledReminder = {
  id: string;
  practiceLocationId: string;
  contactPreferenceId: string;
  recipientMobileEncrypted: string | null;
  status: ScheduledReminderStatus;
  scheduledFor: Date;
  expiresAt: Date;
  messageBody: string | null;
};

export type ScheduledReminderHandoffResult = {
  scheduledReminderId: string;
  status: ScheduledReminderStatus;
  notificationOutboxId: string | null;
  disposition:
    'HANDED_OFF' | 'NOT_DUE' | 'EXPIRED' | 'CANCELLED' | 'ALREADY_HANDED_OFF';
};

@Injectable()
export class ScheduledReminderHandoffService {
  private readonly publicAppBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {
    this.publicAppBaseUrl = this.configService
      .getOrThrow<string>('PUBLIC_APP_BASE_URL')
      .replace(/\/+$/u, '');
  }

  async handoffOne(
    scheduledReminderId: string,
    now = new Date(),
  ): Promise<ScheduledReminderHandoffResult> {
    return this.prisma.$transaction((transaction) =>
      this.handoffOneInTransaction(transaction, scheduledReminderId, now),
    );
  }

  async handoffOneInTransaction(
    transaction: TransactionClient,
    scheduledReminderId: string,
    now = new Date(),
  ): Promise<ScheduledReminderHandoffResult> {
    const rows = await transaction.$queryRaw<LockedScheduledReminder[]>(
      Prisma.sql`
        SELECT
          "id",
          "practiceLocationId",
          "contactPreferenceId",
          "recipientMobileEncrypted",
          "status",
          "scheduledFor",
          "expiresAt",
          "messageBody"
        FROM "ScheduledReminder"
        WHERE "id" = ${scheduledReminderId}
        FOR UPDATE
      `,
    );
    const reminder = rows[0];
    if (!reminder) {
      throw new Error('Scheduled reminder was not found.');
    }

    const existingOutbox = await transaction.notificationOutbox.findUnique({
      where: { scheduledReminderId: reminder.id },
      select: { id: true },
    });
    if (existingOutbox) {
      return {
        scheduledReminderId: reminder.id,
        status: reminder.status,
        notificationOutboxId: existingOutbox.id,
        disposition: 'ALREADY_HANDED_OFF',
      };
    }

    if (reminder.status !== ScheduledReminderStatus.SCHEDULED) {
      return {
        scheduledReminderId: reminder.id,
        status: reminder.status,
        notificationOutboxId: null,
        disposition:
          reminder.status === ScheduledReminderStatus.CANCELLED
            ? 'CANCELLED'
            : 'ALREADY_HANDED_OFF',
      };
    }

    if (reminder.scheduledFor.getTime() > now.getTime()) {
      return {
        scheduledReminderId: reminder.id,
        status: reminder.status,
        notificationOutboxId: null,
        disposition: 'NOT_DUE',
      };
    }

    if (reminder.expiresAt.getTime() <= now.getTime()) {
      await transaction.scheduledReminder.update({
        where: { id: reminder.id },
        data: {
          status: ScheduledReminderStatus.EXPIRED,
          expiredAt: now,
        },
      });
      return {
        scheduledReminderId: reminder.id,
        status: ScheduledReminderStatus.EXPIRED,
        notificationOutboxId: null,
        disposition: 'EXPIRED',
      };
    }

    const preference = await transaction.contactPreference.findUnique({
      where: { id: reminder.contactPreferenceId },
      select: {
        allowFollowUpReminder: true,
        withdrawnAt: true,
      },
    });
    if (
      !preference ||
      !preference.allowFollowUpReminder ||
      preference.withdrawnAt
    ) {
      await transaction.scheduledReminder.update({
        where: { id: reminder.id },
        data: {
          status: ScheduledReminderStatus.CANCELLED,
          cancelledAt: now,
        },
      });
      return {
        scheduledReminderId: reminder.id,
        status: ScheduledReminderStatus.CANCELLED,
        notificationOutboxId: null,
        disposition: 'CANCELLED',
      };
    }

    if (!reminder.recipientMobileEncrypted || !reminder.messageBody?.trim()) {
      throw new Error('Scheduled reminder delivery payload is incomplete.');
    }

    const bookingUrl = `${this.publicAppBaseUrl}/book/${encodeURIComponent(reminder.practiceLocationId)}`;
    const finalMessage = `${reminder.messageBody.trim()}\n\nBook again: ${bookingUrl}`;
    const deliveryIdentityKey = this.hash(
      `${NotificationType.SCHEDULED_REMINDER}|${reminder.id}`,
    );

    const outbox = await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        channel: NotificationChannel.SMS,
        notificationType: NotificationType.SCHEDULED_REMINDER,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: reminder.practiceLocationId,
        scheduledReminderId: reminder.id,
        recipientMobileEncrypted: reminder.recipientMobileEncrypted,
        recipientEmailEncrypted: null,
        messageBodyEncrypted:
          this.notificationPayload.encryptMessage(finalMessage),
        providerIdempotencyKey: `scheduled-reminder:${reminder.id}`,
        attemptCount: 0,
        nextAttemptAt: now,
        expiresAt: reminder.expiresAt,
        createdAt: now,
      },
      select: { id: true },
    });

    await transaction.scheduledReminder.update({
      where: { id: reminder.id },
      data: { status: ScheduledReminderStatus.PROCESSING },
    });

    return {
      scheduledReminderId: reminder.id,
      status: ScheduledReminderStatus.PROCESSING,
      notificationOutboxId: outbox.id,
      disposition: 'HANDED_OFF',
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
