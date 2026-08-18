import { BadRequestException } from '@nestjs/common';
import { NotificationOutboxStatus } from '../../generated/prisma/client';
import {
  NotificationProviderReconciliationOutcome,
  NotificationProviderReconciliationResult,
} from './notification-provider-adapter';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';

type OutboxRow = {
  id: string;
  status: NotificationOutboxStatus;
  attemptCount: number;
  processingWorkerId: string | null;
  leaseExpiresAt: Date | null;
};

type UpdateArgs = {
  where: { id: string };
  data: { status: NotificationOutboxStatus; [key: string]: unknown };
  select: { status: true };
};

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<OutboxRow[]>, unknown[]>;
  notificationOutbox: {
    update: jest.Mock<Promise<{ status: NotificationOutboxStatus }>, [UpdateArgs]>;
  };
};

describe('NotificationOutboxReconciliationService', () => {
  const now = new Date('2026-08-18T13:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-18T13:05:00.000Z');
  const outboxRow: OutboxRow = {
    id: 'outbox-1',
    status: NotificationOutboxStatus.PROCESSING,
    attemptCount: 1,
    processingWorkerId: 'reconciler-1',
    leaseExpiresAt,
  };

  function createService(row: OutboxRow = outboxRow) {
    const transaction: MockTransaction = {
      $queryRaw: jest.fn<Promise<OutboxRow[]>, unknown[]>(() =>
        Promise.resolve([row]),
      ),
      notificationOutbox: {
        update: jest.fn<
          Promise<{ status: NotificationOutboxStatus }>,
          [UpdateArgs]
        >(({ data }) => Promise.resolve({ status: data.status })),
      },
    };

    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationOutboxReconciliationService(prisma as never),
      transaction,
    };
  }

  async function apply(
    result: NotificationProviderReconciliationResult,
    row: OutboxRow = outboxRow,
  ) {
    const fixture = createService(row);
    const applied = await fixture.service.applyReconciliation(
      row.id,
      'reconciler-1',
      result,
      now,
    );
    return { ...fixture, applied };
  }

  it('marks confirmed provider success as sent without incrementing attempt count', async () => {
    const confirmedAt = new Date('2026-08-18T12:59:30.000Z');
    const { transaction, applied } = await apply({
      outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
      providerConfirmedAt: confirmedAt,
    });

    expect(applied.outboxStatus).toBe(NotificationOutboxStatus.SENT);
    const [call] = transaction.notificationOutbox.update.mock.calls;
    expect(call[0]).toEqual({
      where: { id: outboxRow.id },
      data: {
        status: NotificationOutboxStatus.SENT,
        sentAt: confirmedAt,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
      },
      select: { status: true },
    });
  });

  it('returns confirmed not-accepted outcome to pending with a future retry time', async () => {
    const nextAttemptAt = new Date('2026-08-18T13:10:00.000Z');
    const { transaction, applied } = await apply({
      outcome:
        NotificationProviderReconciliationOutcome.RETRY_SAFE_NOT_ACCEPTED,
      nextAttemptAt,
    });

    expect(applied.outboxStatus).toBe(NotificationOutboxStatus.PENDING);
    const [call] = transaction.notificationOutbox.update.mock.calls;
    expect(call[0].data).toEqual({
      status: NotificationOutboxStatus.PENDING,
      nextAttemptAt,
      processingStartedAt: null,
      leaseExpiresAt: null,
      processingWorkerId: null,
    });
  });

  it('marks confirmed permanent provider failure as failed', async () => {
    const { transaction, applied } = await apply({
      outcome:
        NotificationProviderReconciliationOutcome.CONFIRMED_PERMANENT_FAILURE,
    });

    expect(applied.outboxStatus).toBe(NotificationOutboxStatus.FAILED);
    const [call] = transaction.notificationOutbox.update.mock.calls;
    expect(call[0].data).toEqual({
      status: NotificationOutboxStatus.FAILED,
      failedAt: now,
      processingStartedAt: null,
      leaseExpiresAt: null,
      processingWorkerId: null,
    });
  });

  it('keeps still-uncertain delivery processing and does not create a retry transition', async () => {
    const { transaction, applied } = await apply({
      outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN,
    });

    expect(applied.outboxStatus).toBe(NotificationOutboxStatus.PROCESSING);
    const [call] = transaction.notificationOutbox.update.mock.calls;
    expect(call[0].data).toEqual({
      status: NotificationOutboxStatus.PROCESSING,
    });
  });

  it('rejects reconciliation by a worker that does not own the active lease', async () => {
    const { service, transaction } = createService({
      ...outboxRow,
      processingWorkerId: 'other-worker',
    });

    await expect(
      service.applyReconciliation(
        outboxRow.id,
        'reconciler-1',
        {
          outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it('requires a future retry time when reconciliation proves retry is safe', async () => {
    const { service } = createService();

    await expect(
      service.applyReconciliation(
        outboxRow.id,
        'reconciler-1',
        {
          outcome:
            NotificationProviderReconciliationOutcome.RETRY_SAFE_NOT_ACCEPTED,
          nextAttemptAt: now,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
