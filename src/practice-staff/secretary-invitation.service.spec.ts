import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    secretaryInvitation: { create: jest.fn() },
    notificationOutbox: { create: jest.fn() },
  };
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    secretaryInvitation: { findUnique: jest.fn() },
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
  const service = new SecretaryInvitationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    payload as unknown as ProtectedAccountPayloadService,
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
      // Jest's asymmetric matcher is intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        normalizedEmail: 'jane@example.test',
        firstName: 'Jane',
        lastName: 'Reyes',
        status: 'PENDING',
      }),
    });
    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      // Jest's asymmetric matcher is intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        notificationType: 'SECRETARY_INVITATION',
        channel: 'EMAIL',
        secretaryInvitationId: 'invite-1',
      }),
    });
    expect(
      JSON.stringify(transaction.secretaryInvitation.create.mock.calls[0]),
    ).not.toContain('password');
    expect(payload.encrypt).toHaveBeenCalledTimes(2);
  });
});
