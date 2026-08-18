import { BadRequestException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';

describe('NotificationOutboxClaimService', () => {
  const now = new Date('2026-08-18T10:00:00.000Z');

  function createService(candidateId: string | null) {
    const queryRaw = jest.fn(() =>
      Promise.resolve(candidateId ? [{ id: candidateId }] : []),
    );
    const update = jest.fn((args: { where: { id: string }; data: object }) =>
      Promise.resolve({
        id: args.where.id,
        notificationType: NotificationType.BOOKING_CONFIRMATION,
        channel: NotificationChannel.SMS,
        recipientMobileEncrypted: 'encrypted-mobile',
        recipientEmailEncrypted: null,
        messageBodyEncrypted: 'encrypted-message',
        providerIdempotencyKey: 'provider-key-1',
        attemptCount: 0,
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        processingWorkerId: 'worker-1',
      }),
    );
    const transaction = {
      $queryRaw: queryRaw,
      notificationOutbox: { update },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => unknown) =>
          Promise.resolve(callback(transaction)),
      ),
    };

    return {
      service: new NotificationOutboxClaimService(prisma as never),
      queryRaw,
      update,
    };
  }

  it('claims one eligible outbox and writes PROCESSING lease ownership', async () => {
    const { service, update } = createService('outbox-1');

    const result = await service.claimNext(' worker-1 ', 60_000, now);

    expect(result?.id).toBe('outbox-1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: {
          status: NotificationOutboxStatus.PROCESSING,
          processingStartedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          processingWorkerId: 'worker-1',
        },
      }),
    );
  });

  it('returns null when no PENDING outbox is claimable', async () => {
    const { service, update } = createService(null);

    await expect(service.claimNext('worker-1', 60_000, now)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['', 60_000],
    [' '.repeat(2), 60_000],
    ['x'.repeat(101), 60_000],
    ['worker-1', 0],
    ['worker-1', -1],
    ['worker-1', 1.5],
  ])('rejects invalid worker/lease input', async (workerId, leaseMs) => {
    const { service } = createService(null);

    await expect(service.claimNext(workerId, leaseMs, now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
