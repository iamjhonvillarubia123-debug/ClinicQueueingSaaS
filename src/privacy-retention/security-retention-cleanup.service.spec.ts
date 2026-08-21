import { BadRequestException } from '@nestjs/common';
import { SecurityRetentionCleanupService } from './security-retention-cleanup.service';

describe('SecurityRetentionCleanupService', () => {
  const executeRaw = jest.fn<Promise<number>, [unknown]>();
  const transaction = { $executeRaw: executeRaw };
  const prisma = {
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const service = new SecurityRetentionCleanupService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs all approved OTP and recovery cleanup stages in dependency order', async () => {
    executeRaw
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);

    await expect(
      service.cleanupEligible(new Date('2026-08-21T00:00:00.000Z'), 50),
    ).resolves.toEqual({
      otpSecretsCleared: 2,
      otpMobileContextCleared: 3,
      bookingRecoveryProtectedCleared: 4,
      bookingGroupRecoveryProtectedCleared: 5,
      otpShellsDeleted: 6,
      bookingRecoveryShellsDeleted: 7,
      bookingGroupRecoveryShellsDeleted: 8,
    });

    expect(executeRaw).toHaveBeenCalledTimes(7);
  });

  it('allows an idempotent no-op cleanup pass', async () => {
    executeRaw.mockResolvedValue(0);

    await expect(service.cleanupEligible()).resolves.toEqual({
      otpSecretsCleared: 0,
      otpMobileContextCleared: 0,
      bookingRecoveryProtectedCleared: 0,
      bookingGroupRecoveryProtectedCleared: 0,
      otpShellsDeleted: 0,
      bookingRecoveryShellsDeleted: 0,
      bookingGroupRecoveryShellsDeleted: 0,
    });
  });

  it('rejects invalid batch sizes', async () => {
    await expect(service.cleanupEligible(new Date(), 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
