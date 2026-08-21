import { BadRequestException } from '@nestjs/common';
import { CommandIdempotencyCleanupService } from './command-idempotency-cleanup.service';

describe('CommandIdempotencyCleanupService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    commandIdempotency: {
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    ),
  };
  const service = new CommandIdempotencyCleanupService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes only the locked expired batch', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    transaction.commandIdempotency.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      service.cleanupExpired(new Date('2026-08-21T00:00:00.000Z'), 2),
    ).resolves.toEqual({ examined: 2, deleted: 2 });

    expect(transaction.commandIdempotency.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['one', 'two'] },
        }),
      }),
    );
  });

  it('returns zero when no expired command rows are available', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(service.cleanupExpired()).resolves.toEqual({
      examined: 0,
      deleted: 0,
    });
    expect(transaction.commandIdempotency.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects invalid batch sizes', async () => {
    await expect(service.cleanupExpired(new Date(), 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
