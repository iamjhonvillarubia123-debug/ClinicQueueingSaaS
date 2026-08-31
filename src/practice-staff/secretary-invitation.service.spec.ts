import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    secretaryInvitation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: { create: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    secretaryInvitation: { findUnique: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const config = { get: jest.fn(() => 'https://clinic.example') };
  const payload = {
    encrypt: jest.fn(
      (value: string, purpose: string) => `encrypted:${purpose}:${value}`,
    ),
  };
  const passwords = { hash: jest.fn(() => Promise.resolve('password-hash')) };
  const service = new SecretaryInvitationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    payload as unknown as ProtectedAccountPayloadService,
    passwords as unknown as PasswordSecurityService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not disclose or invite into a clinic outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-2',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'jane@example.test',
        mobileNumber: '09183334444',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires an existing account to use the existing Secretary flow', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-1',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'JANE@example.test',
        mobileNumber: '09183334444',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a pending invitation and protected email without a Doctor-set password', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
    });
    transaction.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    await service.create('doctor-1', {
      practiceLocationId: 'clinic-1',
      firstName: ' Jane ',
      lastName: ' Reyes ',
      email: 'JANE@example.test',
      mobileNumber: '09183334444',
    });
    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        normalizedEmail: 'jane@example.test',
        firstName: 'Jane',
        lastName: 'Reyes',
        status: 'PENDING',
      }) as unknown,
    });
    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: 'SECRETARY_INVITATION',
        channel: 'EMAIL',
        secretaryInvitationId: 'invite-1',
      }) as unknown,
    });
    expect(
      JSON.stringify(transaction.secretaryInvitation.create.mock.calls[0]),
    ).not.toContain('password');
    expect(payload.encrypt).toHaveBeenCalledTimes(2);
  });

  it('accepts a valid invitation by creating a verified Secretary account without granting clinic authority', async () => {
    const token = 'valid-token';
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      activeInvitationKey: 'active-key',
      expiresAt: new Date(Date.now() + 60_000),
      normalizedEmail: 'jane@example.test',
      firstName: 'Jane',
      lastName: 'Reyes',
      mobileNumber: '09183334444',
      notificationOutbox: { id: 'outbox-1', status: 'SENT' },
    });
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue({ id: 'secretary-1' });
    await expect(service.accept(token, 'Secretary password')).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'SECRETARY',
        emailVerifiedAt: expect.any(Date) as unknown,
        passwordHash: 'password-hash',
      }) as unknown,
    });
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        acceptedUserId: 'secretary-1',
        tokenHash: null,
        activeInvitationKey: null,
      }) as unknown,
    });
    expect(transaction).not.toHaveProperty('practiceStaff');
  });
});
