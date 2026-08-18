import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';

type OutboxRow = {
  id: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  status: NotificationOutboxStatus;
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
};

describe('NotificationDeliveryAttemptService', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-18T12:05:00.000Z');

  const outboxRow: OutboxRow = {
    id: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    status: NotificationOutboxStatus.PROCESSING,
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
