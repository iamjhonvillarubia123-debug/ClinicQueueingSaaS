import { UnauthorizedException } from '@nestjs/common';
import { UserAccountStatus } from '../../generated/prisma/client';
import { FinancialAccessChallengeService } from './financial-access-challenge.service';

describe('FinancialAccessChallengeService', () => {
  const now = new Date('2026-08-20T09:00:00.000Z');

  function createFixture() {
    const transaction = {
      doctorFinancialAccount: {
        findFirst: jest.fn<Promise<{ id: string } | null>, []>(() =>
          Promise.resolve({ id: 'financial-1' }),
        ),
      },
      financialAccessChallenge: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
        create: jest.fn(() => Promise.resolve({ id: 'challenge-1' })),
        update: jest.fn(() =>
          Promise.resolve({ id: 'challenge-1', verifiedAt: now }),
        ),
      },
      notificationOutbox: {
        create: jest.fn(() => Promise.resolve({ id: 'outbox-1' })),
      },
      $queryRaw: jest.fn(() =>
        Promise.resolve([
          {
            id: 'challenge-1',
            codeHash: 'hashed-code',
            expiresAt: new Date(now.getTime() + 60_000),
            attemptCount: 0,
            verifiedAt: null,
            consumedAt: null,
            invalidatedAt: null,
          },
        ]),
      ),
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
      encrypt: jest.fn(() => 'encrypted-email'),
    };
    const notificationPayload = {
      encryptMessage: jest.fn(() => 'encrypted-message'),
    };
    return {
      service: new FinancialAccessChallengeService(
        prisma as never,
        passwordSecurity as never,
        protectedPayload as never,
        notificationPayload as never,
      ),
      transaction,
      passwordSecurity,
    };
  }

  it('creates challenge and EMAIL outbox in one transaction for eligible closed financial owner', async () => {
    const { service, transaction } = createFixture();

    await expect(service.request('Doctor@Example.com', now)).resolves.toEqual({
      accepted: true,
    });

    expect(transaction.doctorFinancialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          doctorUser: { accountStatus: UserAccountStatus.PERMANENTLY_CLOSED },
        }) as object,
      }),
    );
    expect(transaction.financialAccessChallenge.create).toHaveBeenCalledTimes(
      1,
    );
    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same generic result without creating a challenge when email has no eligible account', async () => {
    const { service, transaction } = createFixture();
    transaction.doctorFinancialAccount.findFirst.mockResolvedValue(null);

    await expect(service.request('nobody@example.com', now)).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.financialAccessChallenge.create).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('verifies a live challenge and records verifiedAt', async () => {
    const { service, transaction } = createFixture();

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
