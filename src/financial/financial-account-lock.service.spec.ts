import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinancialAccountLockService } from './financial-account-lock.service';

type QueryArgument = { values?: unknown[] };

describe('FinancialAccountLockService', () => {
  const service = new FinancialAccountLockService();

  function transactionFor(accounts: Record<string, string>) {
    return {
      $queryRaw: jest.fn((query: QueryArgument) => {
        const rawId = query.values?.[0];
        const id = typeof rawId === 'string' ? rawId : '';
        const doctorUserId = accounts[id];
        return Promise.resolve(doctorUserId ? [{ id, doctorUserId }] : []);
      }),
    };
  }

  it('locks and returns the requested financial account', async () => {
    const transaction = transactionFor({ 'account-1': 'doctor-1' });

    await expect(
      service.lockById(transaction as never, 'account-1'),
    ).resolves.toEqual({ id: 'account-1', doctorUserId: 'doctor-1' });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing financial account identity', async () => {
    const transaction = transactionFor({});

    await expect(
      service.lockById(transaction as never, '   '),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an unknown financial account', async () => {
    const transaction = transactionFor({});

    await expect(
      service.lockById(transaction as never, 'missing-account'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('locks a transfer pair in deterministic account-id order', async () => {
    const transaction = transactionFor({
      'account-a': 'doctor-a',
      'account-z': 'doctor-z',
    });

    await expect(
      service.lockPair(transaction as never, 'account-z', 'account-a'),
    ).resolves.toEqual([
      { id: 'account-z', doctorUserId: 'doctor-z' },
      { id: 'account-a', doctorUserId: 'doctor-a' },
    ]);

    const firstQuery = transaction.$queryRaw.mock.calls[0]?.[0];
    const secondQuery = transaction.$queryRaw.mock.calls[1]?.[0];
    expect(firstQuery?.values?.[0]).toBe('account-a');
    expect(secondQuery?.values?.[0]).toBe('account-z');
  });

  it('rejects a transfer whose source and target are the same account', async () => {
    const transaction = transactionFor({ 'account-1': 'doctor-1' });

    await expect(
      service.lockPair(transaction as never, 'account-1', 'account-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });
});
