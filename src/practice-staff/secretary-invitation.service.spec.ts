import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';
import { SecretaryInvitationAssignmentType } from './dto/create-secretary-invitation.dto';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    secretaryInvitation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    practiceStaff: { create: jest.fn(), update: jest.fn() },
    practiceLocation: { update: jest.fn() },
    practiceStaffAuthorityBundle: { updateMany: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn(), create: jest.fn() },
    clinicDay: { findMany: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
    substituteSecretaryCoverageDate: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    substituteSecretaryCoverage: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    secretaryInvitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const payload = { encrypt: jest.fn((value: string) => `encrypted:${value}`) };
  const passwords = { verify: jest.fn() };
  const service = new SecretaryInvitationService(
    prisma as unknown as PrismaService,
    {
      get: jest.fn(() => 'https://clinic.example'),
    } as unknown as ConfigService,
    payload as unknown as ProtectedAccountPayloadService,
    passwords as unknown as PasswordSecurityService,
  );
  const clinicPlan = {
    practiceLocationId: 'clinic-1',
    firstName: 'Jane',
    lastName: 'Reyes',
    email: 'jane@example.test',
    mobileNumber: '09183334444',
    assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
    authorityBundles: [
      ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      passwordHash: 'doctor-hash',
    });
  });

  it('requires a role-specific assignment plan', async () => {
    await expect(
      service.create('doctor-1', { ...clinicPlan, authorityBundles: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not disclose a clinic outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an existing account with an incompatible role', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue({ role: 'DOCTOR' });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates a pending relationship invitation without exposing an unrelated existing Secretary in the directory', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'secretary-1',
      role: 'SECRETARY',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      emailVerifiedAt: new Date(),
      firstName: 'Jane',
      lastName: 'Reyes',
      mobileNumber: '09183334444',
    });
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockResolvedValue({
      id: 'invite-existing',
      status: 'PENDING',
      expiresAt: new Date(),
    });
    transaction.notificationOutbox.create.mockResolvedValue({
      id: 'outbox-existing',
    });
    await service.create('doctor-1', clinicPlan);
    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        normalizedEmail: 'jane@example.test',
        status: 'PENDING',
      }) as unknown,
    });
    expect(
      JSON.stringify(transaction.secretaryInvitation.create.mock.calls[0]),
    ).not.toContain('acceptedUserId');
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });

  it('requires and verifies the Doctor password for replacement intent', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: 'staff-current',
    });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.create('doctor-1', { ...clinicPlan, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires the Doctor password when planning Cancel Clinic Day authority', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.create('doctor-1', {
        ...clinicPlan,
        requestedCancelClinicDay: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
  });

  it('updates only a Doctor-owned pending invitation plan', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      updatedAt: new Date(),
    });
    await service.updatePending('doctor-1', 'invite-1', {
      assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      authorityBundles: [
        ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
      ],
    });
    expect(prisma.secretaryInvitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invite-1',
          status: 'PENDING',
          practiceLocation: { doctorProfile: { userId: 'doctor-1' } },
        }) as unknown,
      }),
    );
    expect(prisma.secretaryInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedAssignmentType: 'CLINIC_SECRETARY',
        }) as unknown,
      }),
    );
  });

  it('revokes a pending invitation while preserving its audit row', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
    });
    await service.revokePending('doctor-1', 'invite-1');
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: expect.objectContaining({
        status: 'REVOKED',
        activeInvitationKey: null,
      }) as unknown,
    });
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: {
        status: 'REVOKED',
        revokedAt: expect.any(Date) as unknown,
        activeInvitationKey: null,
      },
    });
    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalled();
  });

  it('shows a revoked invitation token as cancelled and prevents acceptance', async () => {
    const token = 'cancelled-token';
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      status: 'REVOKED',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.preview(token)).resolves.toEqual({
      status: 'CANCELLED',
    });

    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: 'REVOKED',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      notificationOutbox: null,
    });
    await expect(service.accept('secretary-1', token)).rejects.toThrow(
      'cancelled by the Doctor',
    );
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });

  it('creates only a pending relationship invitation with assignment intent', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      expiresAt: new Date(),
    });
    transaction.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    await service.create('doctor-1', clinicPlan);
    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedAssignmentType: 'CLINIC_SECRETARY',
        requestedAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
        expectedCurrentPracticeStaffId: null,
      }) as unknown,
    });
    expect(transaction).not.toHaveProperty('user.create');
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
    expect(
      JSON.stringify(transaction.secretaryInvitation.create.mock.calls[0]),
    ).not.toContain('doctor-hash');
  });

  it('rejects acceptance by an incompatible signed-in role without creating an account', async () => {
    const token = 'valid-token';
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      activeInvitationKey: 'key',
      expiresAt: new Date(Date.now() + 60_000),
      requestedAssignmentType: 'CLINIC_SECRETARY',
      notificationOutbox: null,
    });
    transaction.user.findUnique.mockResolvedValue({
      id: 'doctor-2',
      email: 'jane@example.test',
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      emailVerifiedAt: new Date(),
    });
    await expect(service.accept('doctor-2', token)).rejects.toThrow(
      'Only a signed-in Secretary',
    );
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });
});
