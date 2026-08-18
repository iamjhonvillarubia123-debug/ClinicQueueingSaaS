import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';

describe('NotificationDeliveryAttemptService', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-18T12:05:00.000Z');

  const outboxRow = {
    id: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    status: NotificationOutboxStatus.PROCESSING,
    attemptCount: 0,
    processingWorkerId: 'worker-1',
    leaseExpiresAt,
    providerIdempotencyKey: 'provider-key-1',
  };

  function createService(row = outboxRow) {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([row]),
      notificationLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      notificationOutbox: {
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ status: data.status }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) =>
        callback(transaction),
      ),
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
    expect(transaction.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationOutboxId: outboxRow.id,
        attemptNumber: 1,
        notificationType: NotificationType.OTP_VERIFICATION,
        channel: NotificationChannel.SMS,
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerIdempotencyKeyUsed: 'provider-key-1',
        submittedAt,
        resolvedAt: now,
        retryRecommended: false,
      }),
    });
    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: outboxRow.id },
      data: expect.objectContaining({
        status: NotificationOutboxStatus.SENT,
        attemptCount: 1,
        sentAt: now,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
      }),
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

    expect(transaction.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptNumber: 1,
        outcome: NotificationAttemptOutcome.RETRYABLE_FAILURE,
        retryRecommended: true,
        providerIdempotencyKeyUsed: 'provider-key-1',
      }),
    });
    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: outboxRow.id },
      data: expect.objectContaining({
        status: NotificationOutboxStatus.PENDING,
        nextAttemptAt,
        attemptCount: 1,
      }),
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

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: outboxRow.id },
      data: expect.objectContaining({
        status: NotificationOutboxStatus.FAILED,
        failedAt: now,
        attemptCount: 1,
      }),
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

    expect(transaction.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        resolvedAt: null,
        retryRecommended: false,
        providerIdempotencyKeyUsed: 'provider-key-1',
      }),
    });
    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
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
