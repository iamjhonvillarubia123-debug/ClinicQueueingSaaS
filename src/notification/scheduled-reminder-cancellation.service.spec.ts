import { BadRequestException } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { ScheduledReminderCancellationService } from './scheduled-reminder-cancellation.service';

type OutboxRow = {
  id: string;
  notificationType: NotificationType;
  status: NotificationOutboxStatus;
  scheduledReminderId: string | null;
};

type ReminderRow = {
  id: string;
  status: ScheduledReminderStatus;
};

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<unknown[]>, unknown[]>;
  notificationOutbox: {
    update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
  scheduledReminder: {
    update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
};

describe('ScheduledReminderCancellationService', () => {
  const now = new Date('2026-08-19T04:30:00.000Z');
  const reminderId = 'reminder-1';

  function createService(outbox: OutboxRow | null, reminder: ReminderRow) {
    let queryNumber = 0;
    const transaction: MockTransaction = {
      $queryRaw: jest.fn<Promise<unknown[]>, unknown[]>(() => {
        queryNumber += 1;
        return Promise.resolve(
          queryNumber === 1 ? (outbox ? [outbox] : []) : [reminder],
        );
      }),
      notificationOutbox: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(() =>
          Promise.resolve({}),
        ),
      },
      scheduledReminder: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(() =>
          Promise.resolve({}),
        ),
      },
    };

    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new ScheduledReminderCancellationService(prisma as never),
      transaction,
    };
  }

  it('cancels a scheduled reminder before outbox handoff', async () => {
    const { service, transaction } = createService(null, {
      id: reminderId,
      status: ScheduledReminderStatus.SCHEDULED,
    });

    await expect(service.cancelSafely(reminderId, now)).resolves.toEqual({
      reminderStatus: ScheduledReminderStatus.CANCELLED,
      outboxStatus: null,
      reconciliationRequired: false,
    });

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
    expect(transaction.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: reminderId },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  });

  it('atomically cancels a processing reminder whose outbox is still pending', async () => {
    const { service, transaction } = createService(
      {
        id: 'outbox-1',
        notificationType: NotificationType.SCHEDULED_REMINDER,
        status: NotificationOutboxStatus.PENDING,
        scheduledReminderId: reminderId,
      },
      {
        id: reminderId,
        status: ScheduledReminderStatus.PROCESSING,
      },
    );

    await expect(service.cancelSafely(reminderId, now)).resolves.toEqual({
      reminderStatus: ScheduledReminderStatus.CANCELLED,
      outboxStatus: NotificationOutboxStatus.CANCELLED,
      reconciliationRequired: false,
    });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: now,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
      },
    });
    expect(transaction.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: reminderId },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  });

  it('requires reconciliation instead of cancelling a processing outbox', async () => {
    const { service, transaction } = createService(
      {
        id: 'outbox-2',
        notificationType: NotificationType.SCHEDULED_REMINDER,
        status: NotificationOutboxStatus.PROCESSING,
        scheduledReminderId: reminderId,
      },
      {
        id: reminderId,
        status: ScheduledReminderStatus.PROCESSING,
      },
    );

    await expect(service.cancelSafely(reminderId, now)).resolves.toEqual({
      reminderStatus: ScheduledReminderStatus.PROCESSING,
      outboxStatus: NotificationOutboxStatus.PROCESSING,
      reconciliationRequired: true,
    });

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
    expect(transaction.scheduledReminder.update).not.toHaveBeenCalled();
  });

  it('rejects cancellation after successful delivery', async () => {
    const { service, transaction } = createService(
      {
        id: 'outbox-3',
        notificationType: NotificationType.SCHEDULED_REMINDER,
        status: NotificationOutboxStatus.SENT,
        scheduledReminderId: reminderId,
      },
      {
        id: reminderId,
        status: ScheduledReminderStatus.SENT,
      },
    );

    await expect(service.cancelSafely(reminderId, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
    expect(transaction.scheduledReminder.update).not.toHaveBeenCalled();
  });
});
