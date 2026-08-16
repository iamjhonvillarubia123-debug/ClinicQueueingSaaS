import { BookingDraftCleanupService } from './booking-draft-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BookingDraftCleanupService', () => {
  const transactionMock = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const prismaMock = {
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        Promise.resolve(callback(transactionMock)),
    ),
  };

  let service: BookingDraftCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingDraftCleanupService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('transitions only a bounded locked set of expired pending drafts', async () => {
    transactionMock.$queryRaw.mockResolvedValue([{ id: 'draft-1' }]);
    transactionMock.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    await expect(
      service.expirePendingDrafts(25, new Date('2026-08-16T14:00:00.000Z')),
    ).resolves.toBe(1);

    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no pending draft is eligible for expiration', async () => {
    transactionMock.$queryRaw.mockResolvedValue([]);

    await expect(service.expirePendingDrafts()).resolves.toBe(0);
    expect(transactionMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('clears answers, member identity, OTP protected values, and parent identity atomically', async () => {
    transactionMock.$queryRaw.mockResolvedValue([{ id: 'draft-1' }]);
    transactionMock.$executeRaw
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    await expect(
      service.clearTerminalProtectedData(
        50,
        new Date('2026-08-17T15:00:00.000Z'),
      ),
    ).resolves.toBe(1);

    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('is idempotent when no terminal draft remains eligible', async () => {
    transactionMock.$queryRaw.mockResolvedValue([]);

    await expect(service.clearTerminalProtectedData()).resolves.toBe(0);
    expect(transactionMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('deletes eligible technical shells only after blocking OTP rows are gone', async () => {
    transactionMock.$queryRaw.mockResolvedValue([{ id: 'draft-1' }]);
    transactionMock.$executeRaw
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    await expect(
      service.deleteEligibleTechnicalShells(
        25,
        new Date('2026-08-24T15:00:00.000Z'),
      ),
    ).resolves.toBe(1);

    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it('does not delete when retained dependencies keep a shell ineligible', async () => {
    transactionMock.$queryRaw.mockResolvedValue([]);

    await expect(service.deleteEligibleTechnicalShells()).resolves.toBe(0);
    expect(transactionMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('runs expiration, protected-data cleanup, then technical deletion', async () => {
    transactionMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      service.runOnce(100, new Date('2026-08-24T15:00:00.000Z')),
    ).resolves.toEqual({
      expired: 0,
      protectedDataCleared: 0,
      technicalDeleted: 0,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it('rejects unbounded batch sizes', async () => {
    await expect(service.expirePendingDrafts(0)).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      service.clearTerminalProtectedData(501),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      service.deleteEligibleTechnicalShells(501),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
