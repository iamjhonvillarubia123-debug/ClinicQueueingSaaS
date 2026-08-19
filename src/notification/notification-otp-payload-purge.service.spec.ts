import { BadRequestException } from '@nestjs/common';
import { NotificationOtpPayloadPurgeService } from './notification-otp-payload-purge.service';

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<Array<{ id: string }>>, unknown[]>;
  notificationOutbox: {
    updateMany: jest.Mock<Promise<{ count: number }>, [Record<string, unknown>]>;
  };
};

describe('NotificationOtpPayloadPurgeService', () => {
  const now = new Date('2026-08-19T08:00:00.000Z');

  function createService(candidateIds: string[]) {
    const transaction: MockTransaction = {
      $queryRaw: jest.fn(() =>
        Promise.resolve(candidateIds.map((id) => ({ id }))),
      ),
      notificationOutbox: {
        updateMany: jest.fn(() =>
          Promise.resolve({ count: candidateIds.length }),
        ),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationOtpPayloadPurgeService(prisma as never),
      transaction,
    };
  }

  it('purges selected OTP protected payload while preserving metadata shell', async () => {
    const { service, transaction } = createService(['outbox-1', 'outbox-2']);

    await expect(service.purgeEligible(50, now)).resolves.toEqual({
      purgedCount: 2,
    });

    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          recipientMobileEncrypted: null,
          recipientEmailEncrypted: null,
          messageBodyEncrypted: null,
          protectedPayloadPurgedAt: now,
        },
      }),
    );
  });

  it('returns zero without writing when no OTP payload is eligible', async () => {
    const { service, transaction } = createService([]);

    await expect(service.purgeEligible(50, now)).resolves.toEqual({
      purgedCount: 0,
    });

    expect(transaction.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid cleanup batch sizes', async () => {
    const { service } = createService([]);

    await expect(service.purgeEligible(0, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.purgeEligible(101, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
