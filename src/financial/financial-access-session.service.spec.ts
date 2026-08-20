import { UnauthorizedException } from '@nestjs/common';
import { UserAccountStatus } from '../../generated/prisma/client';
import { FinancialAccessSessionService } from './financial-access-session.service';

describe('FinancialAccessSessionService', () => {
  const now = new Date('2026-08-20T08:00:00.000Z');

  function createFixture() {
    let rawQueryCount = 0;
    const transaction = {
      $queryRaw: jest.fn(() => {
        rawQueryCount += 1;
        if (rawQueryCount === 1) {
          return Promise.resolve([
            {
              id: 'challenge-1',
              recoveryEmailHash: 'hash-1',
              expiresAt: new Date(now.getTime() + 60_000),
              verifiedAt: new Date(now.getTime() - 1_000),
              consumedAt: null,
              invalidatedAt: null,
            },
          ]);
        }
        return Promise.resolve([
          {
            id: 'financial-1',
            recoveryEmailHash: 'hash-1',
            accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
          },
        ]);
      }),
      financialAccessChallenge: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      financialAccessSession: {
        create: jest.fn(() =>
          Promise.resolve({
            id: 'session-1',
            doctorFinancialAccountId: 'financial-1',
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    return {
      service: new FinancialAccessSessionService(prisma as never),
      transaction,
    };
  }

  it('issues a scoped bearer session from one verified challenge', async () => {
    const { service, transaction } = createFixture();

    const result = await service.issueFromVerifiedChallenge(
      'challenge-1',
      'financial-1',
      now,
    );

    expect(result.rawToken).toBeTruthy();
    expect(result.session).toMatchObject({
      id: 'session-1',
      doctorFinancialAccountId: 'financial-1',
    });
    expect(transaction.financialAccessChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { consumedAt: now },
      }),
    );
  });

  it('rejects a challenge whose recovery proof does not match the financial account', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'challenge-1',
          recoveryEmailHash: 'hash-1',
          expiresAt: new Date(now.getTime() + 60_000),
          verifiedAt: now,
          consumedAt: null,
          invalidatedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'financial-1',
          recoveryEmailHash: 'different-hash',
          accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
        },
      ]);

    await expect(
      service.issueFromVerifiedChallenge('challenge-1', 'financial-1', now),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.financialAccessSession.create).not.toHaveBeenCalled();
  });

  it('authorizes only a live session scoped to the expected financial account', async () => {
    const { service, transaction } = createFixture();
    transaction.$queryRaw.mockReset().mockResolvedValueOnce([
      {
        id: 'session-1',
        doctorFinancialAccountId: 'financial-1',
        expiresAt: new Date(now.getTime() + 60_000),
        revokedAt: null,
      },
    ]);

    await expect(
      service.authorize('bearer-token', 'financial-1', now),
    ).resolves.toEqual({
      financialAccessSessionId: 'session-1',
      doctorFinancialAccountId: 'financial-1',
    });
    expect(transaction.financialAccessSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastUsedAt: now },
    });
  });
});
