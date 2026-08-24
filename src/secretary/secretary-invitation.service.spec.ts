import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  NotificationOutboxStatus,
  PracticeLocationLifecycleStatus,
  SecretaryAccessProfile,
  SecretaryInvitationStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    practiceLocation: { findFirst: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn() },
    secretaryInvitation: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    practiceStaff: { create: jest.fn() },
    practiceStaffCapability: { create: jest.fn() },
    notificationOutbox: { create: jest.fn(), updateMany: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    secretaryInvitation: { findFirst: jest.fn() },
  } as unknown as PrismaService;

  const passwordSecurity = {
    assertValid: jest.fn(),
    hash: jest.fn().mockResolvedValue('password-hash'),
  } as unknown as PasswordSecurityService;
  const protectedPayload = {
    encrypt: jest.fn((value: string, purpose: string) => `encrypted:${purpose}:${value.length}`),
  } as unknown as ProtectedAccountPayloadService;
  const mobileNumbers = {
    normalize: jest.fn().mockReturnValue({ canonical: '+639171234567', lastFour: '4567' }),
  } as unknown as MobileNumberService;
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') } as unknown as ConfigService;

  let service: SecretaryInvitationService;
  const eligibleLocation = {
    id: 'location-1', name: 'North Clinic', lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    currentRegularPracticeStaffId: null,
    doctorProfile: { user: { role: UserRole.DOCTOR, accountStatus: UserAccountStatus.ACTIVE, administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretaryInvitationService(prisma, config, passwordSecurity, protectedPayload, mobileNumbers);
    transaction.practiceLocation.findFirst.mockResolvedValue(eligibleLocation);
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.secretaryInvitation.findFirst.mockResolvedValue(null);
    transaction.secretaryInvitation.create.mockResolvedValue({ id: 'invitation-1', expiresAt: new Date('2026-08-27T04:00:00.000Z') });
    transaction.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    transaction.practiceStaffCapability.create.mockResolvedValue({ id: 'capability-1' });
  });

  it('creates only invitation and outbox state before acceptance and defaults to Standard access', async () => {
    const result = await service.create('doctor-1', {
      practiceLocationId: 'location-1', firstName: 'Bea', lastName: 'Cruz', email: 'Bea@example.com', mobileNumber: '09171234567',
      accessProfile: SecretaryAccessProfile.STANDARD,
    });
    expect(result.outcome).toBe('INVITATION_CREATED');
    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedAccessProfile: SecretaryAccessProfile.STANDARD, requestedCanManageServices: false }),
    }));
    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('token');
  });

  it('routes an existing Secretary account to assignment and preserves the requested access selection', async () => {
    transaction.user.findFirst.mockResolvedValue({
      id: 'secretary-1', role: UserRole.SECRETARY, accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE, emailVerifiedAt: new Date(),
    });
    const result = await service.create('doctor-1', {
      practiceLocationId: 'location-1', firstName: 'Bea', lastName: 'Cruz', email: 'bea@example.com', mobileNumber: '09171234567',
      accessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION,
    });
    expect(result).toEqual(expect.objectContaining({
      outcome: 'EXISTING_SECRETARY', secretaryUserId: 'secretary-1', eligibleForAssignment: true,
      requestedAccess: expect.objectContaining({ accessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION, canManageServices: true }),
    }));
    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();
  });

  it('atomically creates the Secretary User, assignment, access profile, and selected capability during acceptance', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: 'invitation-1' }]);
    const token = 'invitation-token';
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    transaction.secretaryInvitation.findUnique.mockResolvedValueOnce({
      id: 'invitation-1', practiceLocationId: 'location-1', invitedByUserId: 'doctor-1', normalizedEmail: 'bea@example.com',
      firstName: 'Bea', lastName: 'Cruz', mobileNumber: '+639171234567', tokenHash, activeInvitationKey: 'active-key',
      status: SecretaryInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 60_000),
      requestedAccessProfile: SecretaryAccessProfile.CUSTOM,
      requestedCanManageClinicDetails: false, requestedCanManageServices: true, requestedCanManageBookingQuestions: false,
      requestedCanManageSchedules: true, requestedCancelClinicDay: false, requestedAssignDaySecretary: true,
      practiceLocation: { id: 'location-1', lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT, currentRegularPracticeStaffId: null },
      notificationOutbox: { id: 'outbox-1' },
    });
    transaction.user.create.mockResolvedValue({ id: 'secretary-1' });
    transaction.practiceStaff.create.mockResolvedValue({ id: 'staff-1' });
    transaction.practiceLocation.update.mockResolvedValue({});
    transaction.secretaryInvitation.update.mockResolvedValue({});
    transaction.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.accept({ token, password: 'Secretary chosen password' })).resolves.toEqual({ accepted: true });
    expect(transaction.practiceStaff.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accessProfile: SecretaryAccessProfile.CUSTOM, canManageServices: true, canManageSchedules: true }),
    }));
    expect(transaction.practiceStaffCapability.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ capabilityType: 'ASSIGN_DAY_SECRETARY', grantedByUserId: 'doctor-1' }),
    }));
    expect(transaction.practiceLocation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { currentRegularPracticeStaffId: 'staff-1' } }));
    expect(transaction.secretaryInvitation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: SecretaryInvitationStatus.ACCEPTED, acceptedUserId: 'secretary-1', tokenHash: null, activeInvitationKey: null }),
    }));
    expect(transaction.notificationOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: NotificationOutboxStatus.PENDING }),
    }));
  });
});
