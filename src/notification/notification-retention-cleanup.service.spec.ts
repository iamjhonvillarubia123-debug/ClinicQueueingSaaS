import { BadRequestException } from '@nestjs/common';
import { NotificationRetentionCleanupService } from './notification-retention-cleanup.service';

describe('NotificationRetentionCleanupService', () => {
  const now = new Date('2026-08-19T15:00:00.000Z');

  function createService(
    options: {
      candidateIds?: string[];
      retainedLogCounts?: Record<string, number>;
      deletedLogCounts?: Record<string, number>;
      deletedOutboxCounts?: Record<string, number>;
    } = {},
  ) {
    const candidateIds = options.candidateIds ?? ['outbox-1'];
    const retainedLogCounts = options.retainedLogCounts ?? {};
    const deletedLogCounts = options.deletedLogCounts ?? {};
    const deletedOutboxCounts = options.deletedOutboxCounts ?? {};

    const transaction = {
      $queryRaw: jest.fn(() =>
        Promise.resolve(candidateIds.map((id) => ({ id }))),
      ),
      notificationLog: {
        count: jest.fn((args: { where: { notificationOutboxId: string } }) =>
          Promise.resolve(
            retainedLogCounts[args.where.notificationOutboxId] ?? 0,
          ),
        ),
        deleteMany: jest.fn(
          (args: { where: { notificationOutboxId: string } }) =>
            Promise.resolve({
              count: deletedLogCounts[args.where.notificationOutboxId] ?? 0,
            }),
        ),
      },
      notificationOutbox: {
        deleteMany: jest.fn((args: { where: { id: string } }) =>
          Promise.resolve({
            count: deletedOutboxCounts[args.where.id] ?? 1,
          }),
        ),
      },
    };

    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationRetentionCleanupService(prisma as never),
      transaction,
    };
  }

  it('deletes eligible logs before deleting their terminal parent outbox', async () => {
    const { service, transaction } = createService({
      deletedLogCounts: { 'outbox-1': 2 },
    });

    await expect(service.cleanupEligible(now, 50)).resolves.toEqual({
      examinedOutboxes: 1,
      deletedLogs: 2,
      deletedOutboxes: 1,
      deferredOutboxes: 0,
    });

    expect(transaction.notificationLog.deleteMany).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.deleteMany).toHaveBeenCalledTimes(1);
    expect(
      transaction.notificationLog.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.notificationOutbox.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('defers parent deletion while any provider-attempt log remains retained', async () => {
    const { service, transaction } = createService({
      retainedLogCounts: { 'outbox-1': 1 },
    });

    await expect(service.cleanupEligible(now)).resolves.toEqual({
      examinedOutboxes: 1,
      deletedLogs: 0,
      deletedOutboxes: 0,
      deferredOutboxes: 1,
    });

    expect(transaction.notificationLog.deleteMany).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.deleteMany).not.toHaveBeenCalled();
  });

  it('is retry-safe when a selected outbox is no longer deletable', async () => {
    const { service } = createService({
      deletedOutboxCounts: { 'outbox-1': 0 },
    });

    await expect(service.cleanupEligible(now)).resolves.toEqual({
      examinedOutboxes: 1,
      deletedLogs: 0,
      deletedOutboxes: 0,
      deferredOutboxes: 1,
    });
  });

  it('handles an empty eligible batch without side effects', async () => {
    const { service, transaction } = createService({ candidateIds: [] });

    await expect(service.cleanupEligible(now)).resolves.toEqual({
      examinedOutboxes: 0,
      deletedLogs: 0,
      deletedOutboxes: 0,
      deferredOutboxes: 0,
    });

    expect(transaction.notificationLog.count).not.toHaveBeenCalled();
    expect(transaction.notificationLog.deleteMany).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an unsafe cleanup batch size', async () => {
    const { service } = createService();

    await expect(service.cleanupEligible(now, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.cleanupEligible(now, 501)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
