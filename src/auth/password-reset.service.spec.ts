import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationOutboxStatus,
  PasswordResetStatus,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordReset: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    userSession: { updateMany: jest.fn() },
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const config = { get: jest.fn().mockReturnValue('https://app.example.test') };
  const payload = { encrypt: jest.fn((value: string) => `enc:${value}`) };
  const passwordSecurity = {
    assertValid: jest.fn(),
    hash: jest.fn().mockResolvedValue('new-password-hash'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: ProtectedAccountPayloadService, useValue: payload },
        { provide: PasswordSecurityService, useValue: passwordSecurity },
      ],
    }).compile();
    service = module.get(PasswordResetService);
    jest.clearAllMocks();
    config.get.mockReturnValue('https://app.example.test');
    payload.encrypt.mockImplementation((value: string) => `enc:${value}`);
    passwordSecurity.hash.mockResolvedValue('new-password-hash');
    transaction.$executeRaw.mockResolvedValue(1);
  });

  it('returns the same generic response and creates nothing for an unknown email', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.request(' Missing@Example.com ')).resolves.toEqual({
      accepted: true,
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'missing@example.com',
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('serializes replacement, revokes the old pending reset, and creates a fresh protected EMAIL outbox', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    transaction.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'doctor@example.com',
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
    });
    transaction.passwordReset.findFirst.mockResolvedValue({
      id: 'reset-old',
      notificationOutbox: {
        id: 'outbox-old',
        status: NotificationOutboxStatus.PENDING,
      },
    });
    transaction.passwordReset.create.mockResolvedValue({ id: 'reset-new' });

    await expect(service.request('doctor@example.com')).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.passwordReset.update).toHaveBeenCalledWith({
      where: { id: 'reset-old' },
      data: expect.objectContaining({
        status: PasswordResetStatus.REVOKED,
        tokenHash: null,
        activeResetKey: null,
      }) as unknown,
    });
    const createCalls = transaction.passwordReset.create.mock
      .calls as unknown as Array<
      Array<{
        data: {
          tokenHash: string;
          activeResetKey: string;
          createdAt: Date;
          expiresAt: Date;
        };
      }>
    >;
    const createData = createCalls[0][0].data;
    expect(createData.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createData.activeResetKey).toMatch(/^[0-9a-f]{64}$/);
    expect(
      createData.expiresAt.getTime() - createData.createdAt.getTime(),
    ).toBe(30 * 60 * 1000);
    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: 'PASSWORD_RESET',
        channel: 'EMAIL',
        practiceLocationId: null,
        passwordResetId: 'reset-new',
        recipientMobileEncrypted: null,
      }) as unknown,
    });
  });

  it('consumes one valid reset, replaces only the password, and revokes all active sessions', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: 'reset-1' }])
      .mockResolvedValueOnce([{ id: 'user-1' }]);
    // Match the actual derived token hash after the service computes it.
    transaction.passwordReset.findUnique.mockImplementation(() => ({
      id: 'reset-1',
      userId: 'user-1',
      status: PasswordResetStatus.PENDING,
      tokenHash: createHash('sha256').update('raw-token', 'utf8').digest('hex'),
      activeResetKey: 'active-key',
      expiresAt: new Date(Date.now() + 60_000),
      notificationOutbox: {
        id: 'outbox-1',
        status: NotificationOutboxStatus.PENDING,
      },
    }));
    const emailVerifiedAt = new Date('2026-08-15T00:00:00Z');
    transaction.user.findUnique.mockResolvedValue({
      id: 'user-1',
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      emailVerifiedAt,
      administrativeRestrictionStatus: 'SUSPENDED',
    });

    await expect(service.consume('raw-token', 'new password')).resolves.toEqual(
      { reset: true },
    );
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-password-hash' },
    });
    expect(transaction.passwordReset.update).toHaveBeenCalledWith({
      where: { id: 'reset-1' },
      data: expect.objectContaining({
        status: PasswordResetStatus.CONSUMED,
        tokenHash: null,
        activeResetKey: null,
      }) as unknown,
    });
    expect(transaction.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
  });

  it('expires an accessed reset without changing the password', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ id: 'reset-expired' }]);
    transaction.passwordReset.findUnique.mockResolvedValue({
      id: 'reset-expired',
      userId: 'user-1',
      status: PasswordResetStatus.PENDING,
      tokenHash: createHash('sha256')
        .update('expired-token', 'utf8')
        .digest('hex'),
      activeResetKey: 'active-key',
      expiresAt: new Date(Date.now() - 1_000),
      notificationOutbox: {
        id: 'outbox-expired',
        status: NotificationOutboxStatus.PENDING,
      },
    });

    await expect(
      service.consume('expired-token', 'new password'),
    ).rejects.toThrow(BadRequestException);
    expect(transaction.passwordReset.update).toHaveBeenCalledWith({
      where: { id: 'reset-expired' },
      data: {
        status: PasswordResetStatus.EXPIRED,
        tokenHash: null,
        activeResetKey: null,
      },
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
});
