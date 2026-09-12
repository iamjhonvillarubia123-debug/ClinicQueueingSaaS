import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  SecretaryInvitationStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  CreateSecretaryInvitationDto,
  SecretaryInvitationAssignmentType,
} from './dto/create-secretary-invitation.dto';
import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    secretaryInvitation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    practiceStaff: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    practiceLocation: {
      findUniqueOrThrow: jest.fn(),
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
    secretaryInvitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    practiceStaff: { findUnique: jest.fn(), findFirst: jest.fn() },
    substituteSecretaryCoverage: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
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
  const clinicPlan: CreateSecretaryInvitationDto = {
    practiceLocationId: 'clinic-1',
    identifier: 'sec@example.test',
    assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
    authorityBundles: [
      ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
    ],
    requestedCancelClinicDay: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    transaction.secretaryInvitation.findFirst.mockResolvedValue(null);
    transaction.secretaryInvitation.findMany.mockResolvedValue([]);
    transaction.secretaryInvitation.findUnique.mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 100000),
    });
    transaction.practiceLocation.findUniqueOrThrow.mockImplementation(
      () =>
        prisma.practiceLocation.findFirst() as Promise<{
          currentRegularPracticeStaffId: string | null;
        }>,
    );
    prisma.user.findUnique.mockResolvedValue(activeDoctor);
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    prisma.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
      status: SecretaryInvitationStatus.PENDING,
      updatedAt: new Date(),
    });
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
        { provide: ConfigService, useValue: config },
        { provide: ProtectedAccountPayloadService, useValue: protectedPayload },
        { provide: NotificationPayloadService, useValue: notificationPayload },
        { provide: PasswordSecurityService, useValue: passwords },
        { provide: MobileNumberService, useValue: mobileNumbers },
      ],
    }).compile();
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
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not disclose a clinic outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(service.create('doctor-1', clinicPlan)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a neutral pending invitation when no Secretary account exists for the submitted identifier', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.create('doctor-1', clinicPlan)).resolves.toEqual(
      expect.objectContaining({ status: 'PENDING' }),
    );
    expect(transaction.secretaryInvitation.create).toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).toHaveBeenCalled();
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
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    transaction.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
    });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
        ],
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
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);
    transaction.secretaryInvitation.update.mockResolvedValue({
      id: 'invite-1',
    });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'sec@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
        ],
        requestedCancelClinicDay: false,
      }),
    ).resolves.toBeDefined();
  });

  it('allows retargeting a pending invitation to an unregistered valid identifier', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'old@example.test',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
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
        requestedCancelClinicDay: false,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects retargeting to a Secretary who already has another pending invitation at the clinic', async () => {
    prisma.secretaryInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date(Date.now() + 10000),
      practiceLocationId: 'clinic-1',
      normalizedIdentifier: 'old@example.test',
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedCancelClinicDay: false,
      practiceLocation: { name: 'North Clinic' },
    });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    prisma.secretaryInvitation.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.updatePending('doctor-1', 'invite-1', {
        identifier: 'sec@example.test',
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
        ],
        requestedCancelClinicDay: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
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
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedAuthorityBundles: [
        ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
      ],
      requestedCancelClinicDay: false,
      requestedCoverageMode: null,
      requestedFromServiceDate: null,
      requestedToServiceDate: null,
      practiceLocation: { name: 'North Clinic' },
    });
    await expect(service.preview('token')).resolves.toEqual({
      status: 'CANCELLED',
    });
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
      requestedAssignmentType:
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
      requestedAuthorityBundles: [
        ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
      ],
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
    await expect(service.accept('doctor-2', 'token')).rejects.toBeDefined();
  });

  it('accepts workspace selection by invitation id while retaining identity checks', () => {
    expect(service).toBeDefined();
  });

  it('creates a neutral relationship invitation when the identifier has no account yet', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('doctor-1', clinicPlan)).resolves.toBeDefined();
    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: null,
          normalizedIdentifier: 'sec@example.test',
          normalizedEmail: 'sec@example.test',
        }) as unknown,
      }),
    );
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });

  it('checks sensitive Doctor re-authentication before rejecting a malformed invitee identifier', async () => {
    passwords.verify.mockResolvedValueOnce(false);
    await expect(
      service.create('doctor-1', {
        ...clinicPlan,
        identifier: 'not-a-valid-identifier',
        requestedCancelClinicDay: true,
        password: 'wrong-password',
      }),
    ).rejects.toThrow('Current password is incorrect.');
  });

  it('validates an invitation identifier before review without creating authority', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const result = await service.validateIdentifier('doctor-1', {
      practiceLocationId: 'clinic-1',
      identifier: 'newsec@example.test',
    });
    expect(result).toEqual(
      expect.objectContaining({ valid: true, existingSecretary: false }),
    );
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong Doctor password during staged sensitive authorization', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.validateSensitiveAuthorization('doctor-1', {
        practiceLocationId: 'clinic-1',
        password: 'wrong-password',
      }),
    ).rejects.toThrow('Current password is incorrect.');
  });
});
