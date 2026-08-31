import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
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
    practiceStaff: { create: jest.fn() },
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

  it('requires an existing Secretary account to use the existing Secretary flow', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'secretary-1',
      role: 'SECRETARY',
    });
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-1',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'JANE@example.test',
        mobileNumber: '09183334444',
      }),
    ).rejects.toThrow('Assign the existing Secretary instead.');
  });

  it('rejects an invitation when the email belongs to an incompatible account role', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-2', role: 'DOCTOR' });
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-1',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'doctor@example.test',
        mobileNumber: '09183334444',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-1',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'doctor@example.test',
        mobileNumber: '09183334444',
      }),
    ).rejects.toThrow('incompatible role');
  });

  it('creates a pending 72-hour invitation and protected email without a Doctor-set password', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockImplementation(
      ({ data }: { data: { expiresAt: Date } }) =>
        Promise.resolve({
          id: 'invite-1',
          status: 'PENDING',
          expiresAt: data.expiresAt,
        }),
    );
    transaction.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    const before = Date.now();
    await service.create('doctor-1', {
      practiceLocationId: 'clinic-1',
      firstName: ' Jane ',
      lastName: ' Reyes ',
      email: 'JANE@example.test',
      mobileNumber: '09183334444',
    });
    const createCalls = transaction.secretaryInvitation.create.mock
      .calls as Array<
      [
        {
          data: {
            normalizedEmail: string;
            firstName: string;
            lastName: string;
            status: string;
            createdAt: Date;
            expiresAt: Date;
          };
        },
      ]
    >;
    const call = createCalls[0][0];
    expect(call.data).toEqual(
      expect.objectContaining({
        normalizedEmail: 'jane@example.test',
        firstName: 'Jane',
        lastName: 'Reyes',
        status: 'PENDING',
      }),
    );
    expect(call.data.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.data.expiresAt.getTime() - call.data.createdAt.getTime()).toBe(
      72 * 60 * 60 * 1000,
    );
    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        notificationType: 'SECRETARY_INVITATION',
        channel: 'EMAIL',
        secretaryInvitationId: 'invite-1',
      }),
    });
    expect(JSON.stringify(createCalls[0])).not.toContain('password');
    expect(payload.encrypt).toHaveBeenCalledTimes(2);
  });

  it('accepts a valid invitation by atomically creating a verified Secretary account and clinic assignment', async () => {
    const token = 'valid-token';
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      practiceLocationId: 'clinic-1',
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
    transaction.practiceStaff.create.mockResolvedValue({ id: 'staff-1' });
    await expect(service.accept(token, 'Secretary password')).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.user.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        role: 'SECRETARY',
        emailVerifiedAt: expect.any(Date),
        passwordHash: 'password-hash',
      }),
    });
    expect(transaction.practiceStaff.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        userId: 'secretary-1',
        practiceLocationId: 'clinic-1',
        staffRole: 'SECRETARY',
        isActive: true,
        activatedAt: expect.any(Date),
      }),
    });
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        status: 'ACCEPTED',
        acceptedUserId: 'secretary-1',
        tokenHash: null,
        activeInvitationKey: null,
      }),
      where: { id: 'invite-1' },
    });
  });

  it('does not mark the invitation accepted if clinic assignment creation fails', async () => {
    const token = 'valid-token';
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      practiceLocationId: 'clinic-1',
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
    transaction.practiceStaff.create.mockRejectedValue(
      new Error('assignment failed'),
    );
    await expect(service.accept(token, 'Secretary password')).rejects.toThrow(
      'assignment failed',
    );
    expect(transaction.secretaryInvitation.update).not.toHaveBeenCalled();
  });
});
