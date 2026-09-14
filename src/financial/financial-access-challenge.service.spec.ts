import { UnauthorizedException } from '@nestjs/common';
import { FinancialAccessChallengeService } from './financial-access-challenge.service';

describe('FinancialAccessChallengeService', () => {
  const now = new Date('2026-08-20T09:00:00.000Z');

  function createFixture() {
    const transaction = {
      financialAccessChallenge: {
        update: jest.fn(() =>
          Promise.resolve({ id: 'challenge-1', verifiedAt: now }),
        ),
      },
      notificationOutbox: {
        create: jest.fn(() => Promise.resolve({ id: 'outbox-1' })),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const passwordSecurity = {
      hash: jest.fn(() => Promise.resolve('hashed-code')),
      verify: jest.fn(() => Promise.resolve(true)),
    };
    const protectedPayload = {
      encrypt: jest.fn(() => 'encrypted-identifier'),
    };
    const notificationPayload = {
      encryptMessage: jest.fn(() => 'encrypted-message'),
    };
    const mobileNumberService = {
      normalize: jest.fn((value: string) => ({ canonical: value })),
      hashCanonical: jest.fn((value: string) => `hash:${value}`),
      encrypt: jest.fn((value: string) => `enc:${value}`),
    };
    return {
      service: new FinancialAccessChallengeService(
        prisma as never,
        passwordSecurity as never,
        protectedPayload as never,
        notificationPayload as never,
        mobileNumberService as never,
      ),
      transaction,
      passwordSecurity,
    };
  }

  it('creates challenge and EMAIL outbox in one transaction for eligible closed financial owner', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw.mockResolvedValueOnce([{ id: 'financial-1' }]);

    await expect(service.request('Doctor@Example.com', now)).resolves.toEqual({
      accepted: true,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same generic result without creating a challenge when email has no eligible account', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.request('nobody@example.com', now)).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('verifies a live challenge and records verifiedAt', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        id: 'challenge-1',
        codeHash: 'hashed-code',
        expiresAt: new Date(now.getTime() + 60_000),
        attemptCount: 0,
        verifiedAt: null,
        consumedAt: null,
        invalidatedAt: null,
      },
    ]);

    await expect(service.verify('challenge-1', '123456', now)).resolves.toEqual(
      {
        challengeId: 'challenge-1',
        verifiedAt: now,
      },
    );
    expect(transaction.financialAccessChallenge.update).toHaveBeenCalledWith({
      where: { id: 'challenge-1' },
      data: { verifiedAt: now },
      select: { id: true, verifiedAt: true },
    });
  });

  it('increments attempts and rejects an invalid code', async () => {
    const { service, transaction, passwordSecurity } = createFixture();
    transaction.$queryRaw.mockResolvedValueOnce([
      {
        id: 'challenge-1',
        codeHash: 'hashed-code',
        expiresAt: new Date(now.getTime() + 60_000),
        attemptCount: 0,
        verifiedAt: null,
        consumedAt: null,
        invalidatedAt: null,
      },
    ]);
    passwordSecurity.verify.mockResolvedValue(false);

    await expect(
      service.verify('challenge-1', '000000', now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.financialAccessChallenge.update).toHaveBeenCalledWith({
      where: { id: 'challenge-1' },
      data: { attemptCount: 1, invalidatedAt: null },
    });
  });
});
