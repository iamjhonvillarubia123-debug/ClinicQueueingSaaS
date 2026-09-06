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
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
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
      updateMany: jest.fn(),
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
  const notificationPayload = {
    encryptMessage: jest.fn((value: string) => `message:${value}`),
  };
  const passwords = { verify: jest.fn() };
  const mobileNumbers = {
    normalize: jest.fn((value: string) => ({ canonical: value })),
    hashCanonical: jest.fn((value: string) => `hash:${value}`),
    encryptCanonical: jest.fn((value: string) => `mobile:${value}`),
  };
  const service = new SecretaryInvitationService(
    prisma as unknown as PrismaService,
    {
      get: jest.fn(() => 'https://clinic.example'),
    } as unknown as ConfigService,
    payload as unknown as ProtectedAccountPayloadService,
    notificationPayload as unknown as NotificationPayloadService,
    passwords as unknown as PasswordSecurityService,
    mobileNumbers as unknown as MobileNumberService,
  );
  const clinicPlan = {
    practiceLocationId: 'clinic-1',
    identifier: 'jane@example.test',
    assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
    authorityBundles: [
      ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
    ],
  };
  const activeSecretary = {
    id: 'secretary-1',
    role: 'SECRETARY',
    accountStatus: 'ACTIVE',
    administrativeRestrictionStatus: 'NONE',
    loginIdentifierType: 'EMAIL',
    email: 'jane@example.test',
    emailVerifiedAt: new Date(),
    mobileNumber: '09183334444',
    mobileNumberHash: 'hash:09183334444',
    mobileVerifiedAt: null,
    firstName: 'Jane',
    lastName: 'Reyes',
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

  it('rejects an invitation when no Secretary account exists for the submitted email', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.create('doctor-1', clinicPlan)).rejects.toThrow(
      'No Secretary account was found for this email. Please review the email address for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
    );
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('rejects an existing account with an incompatible role', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      role: 'DOCTOR',
    });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires the matched Secretary account to be active and its primary email verified', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      emailVerifiedAt: null,
    });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toThrow(
      'must be active and its registered email address must be verified',
    );
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
  });

  it('creates a pending relationship invitation for an eligible existing Secretary', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
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
        targetUserId: 'secretary-1',
        normalizedIdentifier: 'jane@example.test',
        normalizedEmail: 'jane@example.test',
        firstName: 'Jane',
        lastName: 'Reyes',
        mobileNumber: '09183334444',
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
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
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
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
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
      practiceLocationId: 'clinic-1',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      normalizedIdentifier: 'jane@example.test',
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      updatedAt: new Date(),
    });
    await service.updatePending('doctor-1', 'invite-1', {
      identifier: 'jane@example.test',
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

  it('retargets a pending invitation only after resolving an eligible corrected email and rotates delivery', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocationId: 'clinic-1',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      normalizedIdentifier: 'wrong@example.test',
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      id: 'secretary-2',
      email: 'correct@example.test',
      firstName: 'Correct',
    });
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      updatedAt: new Date(),
    });
    transaction.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

    await service.updatePending('doctor-1', 'invite-1', {
      identifier: 'correct@example.test',
      assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      authorityBundles: [
        ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
      ],
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          loginIdentifierType: 'EMAIL',
          email: 'correct@example.test',
        }) as unknown,
      }),
    );
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: 'secretary-2',
          identifierType: 'EMAIL',
          normalizedIdentifier: 'correct@example.test',
          normalizedEmail: 'correct@example.test',
          tokenHash: expect.any(String) as unknown,
          activeInvitationKey: expect.any(String) as unknown,
          requestedAssignmentType: 'CLINIC_SECRETARY',
        }) as unknown,
      }),
    );
    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { secretaryInvitationId: 'invite-1' },
        data: expect.objectContaining({
          channel: 'EMAIL',
          status: 'PENDING',
          recipientEmailEncrypted: 'encrypted:correct@example.test',
          recipientMobileEncrypted: null,
          attemptCount: 0,
        }) as unknown,
      }),
    );
  });

  it('rejects a corrected email that has no eligible Secretary account without changing the invitation', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocationId: 'clinic-1',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      normalizedIdentifier: 'wrong@example.test',
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'missing@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
        ],
      }),
    ).rejects.toThrow('No Secretary account was found for this email');
    expect(transaction.secretaryInvitation.update).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('rejects retargeting to a Secretary who already has another pending invitation at the clinic', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocationId: 'clinic-1',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      normalizedIdentifier: 'wrong@example.test',
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      id: 'secretary-2',
      email: 'correct@example.test',
    });
    prisma.secretaryInvitation.findUnique.mockResolvedValue({ id: 'invite-2' });

    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'correct@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
        ],
      }),
    ).rejects.toThrow(
      'A pending invitation already exists for this Secretary at this clinic.',
    );
    expect(transaction.secretaryInvitation.update).not.toHaveBeenCalled();
  });

  it('revokes a pending invitation while preserving its audit row', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({ id: 'invite-1' });
    transaction.secretaryInvitation.updateMany.mockResolvedValue({ count: 1 });
    await service.revokePending('doctor-1', 'invite-1');
    expect(transaction.secretaryInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', status: 'PENDING' },
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
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
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

  it('accepts workspace selection by invitation id while retaining identity checks', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: 'invite-1' }]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      tokenHash: 'stored-hash',
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
    await expect(
      service.acceptPendingById('doctor-2', 'invite-1'),
    ).rejects.toThrow('Only a signed-in Secretary');
    expect(transaction.$queryRaw).toHaveBeenCalled();
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });
});
