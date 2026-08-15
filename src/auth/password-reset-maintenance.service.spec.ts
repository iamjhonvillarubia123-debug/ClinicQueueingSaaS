import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationOutboxStatus,
  NotificationType,
  PasswordResetStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetMaintenanceService } from './password-reset-maintenance.service';

describe('PasswordResetMaintenanceService', () => {
  let service: PasswordResetMaintenanceService;

  const transaction = {
    $queryRaw: jest.fn(),
    passwordReset: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    notificationOutbox: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetMaintenanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PasswordResetMaintenanceService);
    jest.clearAllMocks();
  });

  it('expires a bounded batch and cancels matching pending outboxes', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: 'reset-1' },
      { id: 'reset-2' },
    ]);
    transaction.passwordReset.updateMany.mockResolvedValue({ count: 2 });
    transaction.notificationOutbox.updateMany.mockResolvedValue({ count: 2 });

    await expect(service.expirePendingBatch(25)).resolves.toBe(2);
    expect(transaction.passwordReset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['reset-1', 'reset-2'] },
        status: PasswordResetStatus.PENDING,
        expiresAt: { lte: expect.any(Date) as unknown },
      },
      data: {
        status: PasswordResetStatus.EXPIRED,
        tokenHash: null,
        activeResetKey: null,
      },
    });
    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: {
        passwordResetId: { in: ['reset-1', 'reset-2'] },
        notificationType: NotificationType.PASSWORD_RESET,
        status: NotificationOutboxStatus.PENDING,
      },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: expect.any(Date) as unknown,
      },
    });
  });

  it('expires a stale pending reset during pre-send revalidation and blocks delivery', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: 'outbox-1' }])
      .mockResolvedValueOnce([{ id: 'reset-1' }]);
    transaction.notificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-1',
      notificationType: NotificationType.PASSWORD_RESET,
      status: NotificationOutboxStatus.PENDING,
      passwordResetId: 'reset-1',
    });
    transaction.passwordReset.findUnique.mockResolvedValue({
      id: 'reset-1',
      status: PasswordResetStatus.PENDING,
      expiresAt: new Date(Date.now() - 1_000),
      tokenHash: 'a'.repeat(64),
      activeResetKey: 'b'.repeat(64),
    });
    transaction.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.revalidateOutboxForSend('outbox-1')).resolves.toBe(
      false,
    );
    expect(transaction.passwordReset.update).toHaveBeenCalledWith({
      where: { id: 'reset-1' },
      data: {
        status: PasswordResetStatus.EXPIRED,
        tokenHash: null,
        activeResetKey: null,
      },
    });
  });

  it('permits only a current pending reset with protected credential material to send', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: 'outbox-1' }])
      .mockResolvedValueOnce([{ id: 'reset-1' }]);
    transaction.notificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-1',
      notificationType: NotificationType.PASSWORD_RESET,
      status: NotificationOutboxStatus.PENDING,
      passwordResetId: 'reset-1',
    });
    transaction.passwordReset.findUnique.mockResolvedValue({
      id: 'reset-1',
      status: PasswordResetStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: 'a'.repeat(64),
      activeResetKey: 'b'.repeat(64),
    });

    await expect(service.revalidateOutboxForSend('outbox-1')).resolves.toBe(
      true,
    );
    expect(transaction.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('deletes only terminal rows already free of retained outbox relations', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: 'reset-old' }]);
    transaction.passwordReset.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.deleteEligibleTerminalBatch(10)).resolves.toBe(1);
    expect(transaction.passwordReset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['reset-old'] } },
    });
  });
});
