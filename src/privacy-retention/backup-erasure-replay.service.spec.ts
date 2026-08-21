import { BadRequestException } from '@nestjs/common';
import { BackupErasureReplayService } from './backup-erasure-replay.service';

describe('BackupErasureReplayService', () => {
  const findMany = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    privacyErasureLedger: { findMany },
    $transaction: transaction,
  };
  const service = new BackupErasureReplayService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an idempotent no-op when no valid replay ledgers are loaded', async () => {
    findMany.mockResolvedValueOnce([]);

    await expect(
      service.replayLoadedLedgers(new Date('2026-08-21T00:00:00.000Z'), 50),
    ).resolves.toEqual({
      ledgersProcessed: 0,
      appointmentsReplayed: 0,
      alreadyAbsent: 0,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid batch sizes before reading replay state', async () => {
    await expect(
      service.replayLoadedLedgers(new Date(), 0),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(findMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
