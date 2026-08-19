import { BadRequestException } from '@nestjs/common';
import { NotificationProtectedPayloadPurgeService } from './notification-protected-payload-purge.service';

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<Array<{ id: string }>>, unknown[]>;
  notificationOutbox: {
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [Record<string, unknown>]
    >;
  };
};

describe('NotificationProtectedPayloadPurgeService', () => {
  const now = new Date('2026-08-19T06:00:00.000Z');

  function createService(candidateIds: string[]) {
    const transaction: MockTransaction = {
      $queryRaw: jest.fn(() =>
        Promise.resolve(candidateIds.map((id) => ({ id }))),
      ),
      notificationOutbox: {
        updateMany: jest.fn((args: Record<string, unknown>) => {
          void args;
          return Promise.resolve({ count: candidateIds.length });
        }),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationProtectedPayloadPurgeService(prisma as never),
      transaction,
    };
  }

  it('purges protected payload for locked eligible terminal outboxes', async () => {
    const { service, transaction } = createService(['outbox-1', 'outbox-2']);

    await expect(service.purgeEligible(now, 25)).resolves.toEqual({
      purgedCount: 2,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['outbox-1', 'outbox-2'] },
        protectedPayloadPurgedAt: null,
      },
      data: {
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: null,
        protectedPayloadPurgedAt: now,
      },
    });
  });

  it('is retry-safe when no eligible terminal rows remain', async () => {
    const { service, transaction } = createService([]);

    await expect(service.purgeEligible(now)).resolves.toEqual({
      purgedCount: 0,
    });

    expect(transaction.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid cleanup batch sizes', async () => {
    const { service } = createService([]);

    await expect(service.purgeEligible(now, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.purgeEligible(now, 501)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
