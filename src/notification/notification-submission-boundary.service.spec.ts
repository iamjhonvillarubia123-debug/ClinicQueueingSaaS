import { BadRequestException } from '@nestjs/common';
import { NotificationOutboxStatus } from '../../generated/prisma/client';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<unknown[]>, unknown[]>;
  notificationLog: {
    findFirst: jest.Mock<
      Promise<{ attemptNumber: number } | null>,
      [Record<string, unknown>]
    >;
  };
  notificationOutbox: {
    update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
};

describe('NotificationSubmissionBoundaryService', () => {
  const now = new Date('2026-08-19T05:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-19T05:05:00.000Z');

  function createService(attemptCount: number, latestRecordedAttempt: number) {
    const transaction: MockTransaction = {
      $queryRaw: jest.fn(() =>
        Promise.resolve([
          {
            id: 'outbox-1',
            status: NotificationOutboxStatus.PROCESSING,
            attemptCount,
            processingWorkerId: 'worker-1',
            leaseExpiresAt,
          },
        ]),
      ),
      notificationLog: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            latestRecordedAttempt > 0
              ? { attemptNumber: latestRecordedAttempt }
              : null,
          ),
        ),
      },
      notificationOutbox: {
        update: jest.fn(() => Promise.resolve({})),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationSubmissionBoundaryService(prisma as never),
      transaction,
    };
  }

  it('allocates the next attempt number before provider submission', async () => {
    const { service, transaction } = createService(2, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ attemptNumber: 3 });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { attemptCount: 3 },
    });
  });

  it('reuses one outstanding reserved attempt after safe reconciliation', async () => {
    const { service, transaction } = createService(3, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ attemptNumber: 3 });

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it('rejects an inconsistent attempt-history gap', async () => {
    const { service } = createService(4, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reservation without an active worker lease', async () => {
    const { service, transaction } = createService(0, 0);
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'outbox-1',
        status: NotificationOutboxStatus.PROCESSING,
        attemptCount: 0,
        processingWorkerId: 'other-worker',
        leaseExpiresAt,
      },
    ]);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
