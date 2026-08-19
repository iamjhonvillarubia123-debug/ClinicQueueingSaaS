import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';

type OutboxRow = {
  id: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  status: NotificationOutboxStatus;
  scheduledReminderId: string | null;
  attemptCount: number;
  processingWorkerId: string | null;
  leaseExpiresAt: Date | null;
  providerIdempotencyKey: string;
};

type OutboxUpdateArgs = {
  where: { id: string };
  data: { status: NotificationOutboxStatus; [key: string]: unknown };
  select: { status: true };
};

type NotificationLogCreateArgs = {
  data: Record<string, unknown>;
};

type ScheduledReminderUpdateManyArgs = {
  where: {
    id: string;
    status: ScheduledReminderStatus;
  };
  data: {
    status: ScheduledReminderStatus;
    sentAt?: Date;
    failedAt?: Date;
  };
};

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<OutboxRow[]>, unknown[]>;
  notificationLog: {
    create: jest.Mock<Promise<{ id: string }>, [NotificationLogCreateArgs]>;
  };
  notificationOutbox: {
    update: jest.Mock<
      Promise<{ status: NotificationOutboxStatus }>,
      [OutboxUpdateArgs]
    >;
  };
  scheduledReminder: {
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [ScheduledReminderUpdateManyArgs]
    >;
  };
};

describe('NotificationDeliveryAttemptService', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-18T12:05:00.000Z');

  const outboxRow: OutboxRow = {
    id: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    status: NotificationOutboxStatus.PROCESSING,
    scheduledReminderId: null,
    attemptCount: 0,
    processingWorkerId: 'worker-1',
    leaseExpiresAt,
    providerIdempotencyKey: 'provider-key-1',
  };

  function createService(row: OutboxRow = outboxRow) {
    const transaction: MockTransaction = {
      $queryRaw: jest.fn<Promise<OutboxRow[]>, unknown[]>(() =>
        Promise.resolve([row]),
      ),
      notificationLog: {
        create: jest.fn<Promise<{ id: string }>, [NotificationLogCreateArgs]>(
          () => Promise.resolve({ id: 'log-1' }),
        ),
      },
      notificationOutbox: {
        update: jest.fn<
          Promise<{ status: NotificationOutboxStatus }>,
          [OutboxUpdateArgs]
        >(({ data }) => Promise.resolve({ status: data.status })),
      },
      scheduledReminder: {
        updateMany: jest.fn<
          Promise<{ count: number }>,
          [ScheduledReminderUpdateManyArgs]
        >(() => Promise.resolve({ count: 1 })),
      },
    };

    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationDeliveryAttemptService(prisma as never),
      transaction,
    };
  }

  it('records success, reuses provider idempotency key, increments attempt count, and marks sent', async () => {
    const { service, transaction } = createService();
    const submittedAt = new Date('2026-08-18T11:59:58.000Z');

    const result = await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: 'ref-1',
        providerStatus: 'accepted',
        submittedAt,
      },
      now,
    );

    expect(result).toEqual({
      notificationLogId: 'log-1',
      attemptNumber: 1,
      outboxStatus: NotificationOutboxStatus.SENT,
    });

    const [logCreateCall] = transaction.notificationLog.create.mock.calls;
    expect(logCreateCall[0].data).toMatchObject({
      notificationOutboxId: outboxRow.id,
      attemptNumber: 1,
      notificationType: NotificationType.OTP_VERIFICATION,
      channel: NotificationChannel.SMS,
      outcome: NotificationAttemptOutcome.SUCCESS,
      providerIdempotencyKeyUsed: 'provider-key-1',
      submittedAt,
      resolvedAt: now,
      retryRecommended: false,
    });

    const [outboxUpdateCall] = transaction.notificationOutbox.update.mock.calls;
    expect(outboxUpdateCall[0]).toMatchObject({
      where: { id: outboxRow.id },
      data: {
        status: NotificationOutboxStatus.SENT,
        attemptCount: 1,
        sentAt: now,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
      },
      select: { status: true },
    });

    expect(transaction.scheduledReminder.updateMany).not.toHaveBeenCalled();
  });

  it('records retryable failure and returns the same logical outbox to pending', async () => {
    const { service, transaction } = createService();
    const nextAttemptAt = new Date('2026-08-18T12:10:00.000Z');

    await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.RETRYABLE_FAILURE,
        providerName: 'provider-a',
        providerErrorCode: 'timeout',
        failureDetailSanitized: 'Provider timeout',
        submittedAt: new Date('2026-08-18T11:59:58.000Z'),
        nextAttemptAt,
      },
      now,
    );

    const [logCreateCall] = transaction.notificationLog.create.mock.calls;
    expect(logCreateCall[0].data).toMatchObject({
      attemptNumber: 1,
      outcome: NotificationAttemptOutcome.RETRYABLE_FAILURE,
      retryRecommended: true,
      providerIdempotencyKeyUsed: 'provider-key-1',
    });

    const [outboxUpdateCall] = transaction.notificationOutbox.update.mock.calls;
    expect(outboxUpdateCall[0]).toMatchObject({
      where: { id: outboxRow.id },
      data: {
        status: NotificationOutboxStatus.PENDING,
        nextAttemptAt,
        attemptCount: 1,
      },
      select: { status: true },
    });
  });

  it('records permanent failure and marks the outbox failed', async () => {
    const { service, transaction } = createService();

    await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
        submittedAt: new Date('2026-08-18T11:59:58.000Z'),
      },
      now,
    );

    const [outboxUpdateCall] = transaction.notificationOutbox.update.mock.calls;
    expect(outboxUpdateCall[0]).toMatchObject({
      where: { id: outboxRow.id },
      data: {
        status: NotificationOutboxStatus.FAILED,
        failedAt: now,
        attemptCount: 1,
      },
      select: { status: true },
    });
  });

  it('retains uncertain submission as processing for reconciliation without blind retry', async () => {
    const { service, transaction } = createService();

    await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerReference: 'maybe-submitted-1',
        submittedAt: new Date('2026-08-18T11:59:58.000Z'),
      },
      now,
    );

    const [logCreateCall] = transaction.notificationLog.create.mock.calls;
    expect(logCreateCall[0].data).toMatchObject({
      outcome: NotificationAttemptOutcome.UNCERTAIN,
      resolvedAt: null,
      retryRecommended: false,
      providerIdempotencyKeyUsed: 'provider-key-1',
    });

    const [outboxUpdateCall] = transaction.notificationOutbox.update.mock.calls;
    expect(outboxUpdateCall[0]).toEqual({
      where: { id: outboxRow.id },
      data: {
        status: NotificationOutboxStatus.PROCESSING,
        attemptCount: 1,
      },
      select: { status: true },
    });
  });

  it('synchronizes scheduled reminder to sent when provider delivery succeeds', async () => {
    const scheduledReminderId = 'reminder-1';
    const { service, transaction } = createService({
      ...outboxRow,
      notificationType: NotificationType.SCHEDULED_REMINDER,
      scheduledReminderId,
    });

    await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.SUCCESS,
        submittedAt: now,
      },
      now,
    );

    expect(transaction.scheduledReminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: scheduledReminderId,
        status: ScheduledReminderStatus.PROCESSING,
      },
      data: {
        status: ScheduledReminderStatus.SENT,
        sentAt: now,
      },
    });
  });

  it('synchronizes scheduled reminder to failed on permanent delivery failure', async () => {
    const scheduledReminderId = 'reminder-2';
    const { service, transaction } = createService({
      ...outboxRow,
      notificationType: NotificationType.SCHEDULED_REMINDER,
      scheduledReminderId,
    });

    await service.finalizeAttempt(
      outboxRow.id,
      'worker-1',
      {
        outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
        submittedAt: now,
      },
      now,
    );

    expect(transaction.scheduledReminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: scheduledReminderId,
        status: ScheduledReminderStatus.PROCESSING,
      },
      data: {
        status: ScheduledReminderStatus.FAILED,
        failedAt: now,
      },
    });
  });

  it.each([
    NotificationAttemptOutcome.RETRYABLE_FAILURE,
    NotificationAttemptOutcome.UNCERTAIN,
  ])(
    'leaves scheduled reminder processing for %s provider outcome',
    async (outcome) => {
      const { service, transaction } = createService({
        ...outboxRow,
        notificationType: NotificationType.SCHEDULED_REMINDER,
        scheduledReminderId: 'reminder-3',
      });

      await service.finalizeAttempt(
        outboxRow.id,
        'worker-1',
        {
          outcome,
          submittedAt: now,
          ...(outcome === NotificationAttemptOutcome.RETRYABLE_FAILURE
            ? { nextAttemptAt: new Date('2026-08-18T12:10:00.000Z') }
            : {}),
        },
        now,
      );

      expect(transaction.scheduledReminder.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects scheduled reminder terminal synchronization when the reminder is not processing', async () => {
    const { service, transaction } = createService({
      ...outboxRow,
      notificationType: NotificationType.SCHEDULED_REMINDER,
      scheduledReminderId: 'reminder-4',
    });
    transaction.scheduledReminder.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      service.finalizeAttempt(
        outboxRow.id,
        'worker-1',
        {
          outcome: NotificationAttemptOutcome.SUCCESS,
          submittedAt: now,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects finalization when the worker does not own an active lease', async () => {
    const { service, transaction } = createService({
      ...outboxRow,
      processingWorkerId: 'other-worker',
    });

    await expect(
      service.finalizeAttempt(
        outboxRow.id,
        'worker-1',
        {
          outcome: NotificationAttemptOutcome.SUCCESS,
          submittedAt: now,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.notificationLog.create).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it('requires a future retry timestamp for retryable failures', async () => {
    const { service } = createService();

    await expect(
      service.finalizeAttempt(
        outboxRow.id,
        'worker-1',
        {
          outcome: NotificationAttemptOutcome.RETRYABLE_FAILURE,
          submittedAt: now,
          nextAttemptAt: now,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
