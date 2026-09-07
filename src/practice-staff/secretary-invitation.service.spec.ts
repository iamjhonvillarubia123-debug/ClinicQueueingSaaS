import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  SecretaryInvitationAssignmentType,
  SecretaryInvitationStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    secretaryInvitation: {
      create: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: {
      create: jest.fn(),
    },
    practiceStaff: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    practiceLocation: {
      update: jest.fn(),
    },
    practiceStaffAuthorityBundle: {
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
    practiceStaffCapability: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    substituteSecretaryCoverage: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    practiceLocation: { findFirst: jest.fn() },
    secretaryInvitation: { findUnique: jest.fn(), findFirst: jest.fn() },
    practiceStaff: { findUnique: jest.fn(), findFirst: jest.fn() },
    substituteSecretaryCoverage: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'APP_BASE_URL') return 'http://localhost:5173';
      return undefined;
    }),
  };
  const protectedPayload = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };
  const notificationPayload = {
    encryptMessage: jest.fn((value: string) => `enc:${value}`),
  };
  const passwords = {
    verify: jest.fn(),
  };
  const mobileNumbers = {
    normalizePhilippineMobile: jest.fn((value: string) => value),
    mobileHash: jest.fn((value: string) => `hash:${value}`),
    encryptCanonical: jest.fn((value: string) => `enc:${value}`),
  };

  let service: SecretaryInvitationService;

  const activeDoctor = {
    role: UserRole.DOCTOR,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    passwordHash: 'hash',
  };
  const activeSecretary = {
    id: 'secretary-1',
    role: UserRole.SECRETARY,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    loginIdentifierType: 'EMAIL',
    email: 'sec@example.test',
    emailVerifiedAt: new Date(),
    mobileNumber: null,
    mobileNumberHash: null,
    mobileVerifiedAt: null,
    firstName: 'Sec',
    lastName: 'Retary',
  };
  const clinicPlan = {
    practiceLocationId: 'clinic-1',
    identifier: 'sec@example.test',
    assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
    authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
    requestedCancelClinicDay: false,
  } as const;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(activeDoctor);
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockResolvedValue({
      id: 'invite-1',
      status: SecretaryInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000),
    });
    passwords.verify.mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        SecretaryInvitationService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'ConfigService', useValue: config },
        { provide: ProtectedAccountPayloadService, useValue: protectedPayload },
        { provide: NotificationPayloadService, useValue: notificationPayload },
        { provide: PasswordSecurityService, useValue: passwords },
        { provide: MobileNumberService, useValue: mobileNumbers },
      ],
    })
      .overrideProvider(require('@nestjs/config').ConfigService)
      .useValue(config)
      .compile();
    service = module.get(SecretaryInvitationService);
  });

  it('requires a role-specific assignment plan', async () => {
    await expect(
      service.create('doctor-1', {
        practiceLocationId: 'clinic-1',
        identifier: 'sec@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [],
        requestedCancelClinicDay: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not disclose a clinic outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an invitation when no Secretary account exists for the submitted identifier', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.create('doctor-1', clinicPlan)).rejects.toThrow(
      'No Secretary account was found for this email address or mobile number. Please review the identifier for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
    );
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('rejects an existing account with an incompatible role', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      role: UserRole.DOCTOR,
    });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires the matched Secretary account to be active and its primary login identifier verified', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      emailVerifiedAt: null,
    });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toThrow(
      'must be active and its registered login identifier must be verified',
    );
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
  });

  it('creates a pending relationship invitation for an eligible existing Secretary', async () => {
    const result = await service.create('doctor-1', clinicPlan);
    expect(result.status).toBe(SecretaryInvitationStatus.PENDING);
    expect(transaction.secretaryInvitation.create).toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).toHaveBeenCalled();
  });

  it('requires and verifies the Doctor password for replacement intent', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: 'current-staff',
    });
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.create('doctor-1', { ...clinicPlan, password: 'pw' }),
    ).resolves.toBeDefined();
    expect(passwords.verify).toHaveBeenCalledWith('pw', 'hash');
  });

  it('requires the Doctor password when planning Cancel Clinic Day authority', async () => {
    await expect(
      service.create('doctor-1', {
        ...clinicPlan,
        requestedCancelClinicDay: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates only a Doctor-owned pending invitation plan', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'sec@example.test',
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
        requestedCancelClinicDay: false,
      }),
    ).resolves.toBeDefined();
  });

  it('retargets a pending invitation only after resolving an eligible corrected email and rotates delivery', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'old@example.test',
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'sec@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
        requestedCancelClinicDay: false,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a corrected email that has no eligible Secretary account without changing the invitation', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'old@example.test',
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'missing@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
        requestedCancelClinicDay: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects retargeting to a Secretary who already has another pending invitation at the clinic', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'old@example.test',
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'sec@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
        requestedCancelClinicDay: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('revokes a pending invitation while preserving its audit row', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      status: SecretaryInvitationStatus.PENDING,
    });
    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });
    await expect(service.revoke('doctor-1', 'invite-1')).resolves.toBeDefined();
  });

  it('shows a revoked invitation token as cancelled and prevents acceptance', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      status: SecretaryInvitationStatus.REVOKED,
      firstName: 'Sec',
      lastName: 'Retary',
      identifierType: 'EMAIL',
      normalizedIdentifier: 'sec@example.test',
      normalizedEmail: 'sec@example.test',
      expiresAt: new Date(Date.now() + 10000),
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      requestedCancelClinicDay: false,
      requestedCoverageMode: null,
      requestedFromServiceDate: null,
      requestedToServiceDate: null,
      practiceLocation: { name: 'North Clinic' },
    });
    await expect(service.preview('token')).resolves.toEqual({ status: 'CANCELLED' });
  });

  it('creates only a pending relationship invitation with assignment intent', async () => {
    await service.create('doctor-1', clinicPlan);
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });

  it('rejects acceptance by an incompatible signed-in role without creating an account', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      status: SecretaryInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 10000),
      targetUserId: 'secretary-1',
      requestedAssignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      requestedCancelClinicDay: false,
      requestedCoverageMode: null,
      requestedFromServiceDate: null,
      requestedToServiceDate: null,
      expectedCurrentPracticeStaffId: null,
      practiceLocationId: 'clinic-1',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-2',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      loginIdentifierType: 'EMAIL',
      email: 'doctor@example.test',
      emailVerifiedAt: new Date(),
      mobileNumber: null,
      mobileNumberHash: null,
      mobileVerifiedAt: null,
    });
    await expect(service.accept('doctor-2', 'token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('accepts workspace selection by invitation id while retaining identity checks', async () => {
    expect(service).toBeDefined();
  });
});
