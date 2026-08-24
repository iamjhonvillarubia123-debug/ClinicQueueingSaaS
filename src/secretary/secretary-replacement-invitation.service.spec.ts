import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AdministrativeRestrictionStatus,
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
import { SecretaryReplacementInvitationService } from './secretary-replacement-invitation.service';

describe('SecretaryReplacementInvitationService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    practiceLocation: { findFirst: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn() },
    secretaryReplacementInvitation: {
      findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(),
    },
    practiceStaff: { create: jest.fn() },
    notificationOutbox: { create: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    practiceLocation: { findFirst: jest.fn() },
    secretaryReplacementInvitation: { findFirst: jest.fn(), findMany: jest.fn() },
  } as unknown as PrismaService;
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') } as unknown as ConfigService;
  const passwords = { assertValid: jest.fn(), hash: jest.fn().mockResolvedValue('password-hash') } as unknown as PasswordSecurityService;
  const protectedPayload = { encrypt: jest.fn((value: string) => `encrypted:${value.length}`) } as unknown as ProtectedAccountPayloadService;
  const mobileNumbers = { normalize: jest.fn().mockReturnValue({ canonical: '+639171234567', lastFour: '4567' }) } as unknown as MobileNumberService;
  let service: SecretaryReplacementInvitationService;

  const location = {
    id: 'location-1',
    name: 'North Clinic',
    lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
    currentRegularPracticeStaffId: 'incumbent-staff-1',
    doctorProfile: {
      user: {
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretaryReplacementInvitationService(prisma, config, passwords, protectedPayload, mobileNumbers);
    transaction.practiceLocation.findFirst.mockResolvedValue(location);
    transaction.user.findFirst.mockResolvedValue(null);
    transaction.secretaryReplacementInvitation.findFirst.mockResolvedValue(null);
    transaction.secretaryReplacementInvitation.create.mockResolvedValue({ id: 'replacement-invitation-1', expiresAt: new Date(Date.now() + 60_000) });
    transaction.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
  });

  it('creates a replacement invitation tied to the current incumbent without changing staffing', async () => {
    const result = await service.create('doctor-1', {
      practiceLocationId: 'location-1',
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'ana@example.com',
      mobileNumber: '09171234567',
      accessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION,
      cancelClinicDay: false,
      assignDaySecretary: true,
    });

    expect(result.outcome).toBe('INVITATION_CREATED');
    expect(transaction.secretaryReplacementInvitation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        replacementForPracticeStaffId: 'incumbent-staff-1',
        requestedAccessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION,
        requestedAssignDaySecretary: true,
      }),
    }));
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
    expect(transaction.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('accepts by creating the Secretary account only and leaves clinic authority with the incumbent', async () => {
    const token = 'replacement-token';
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    transaction.$queryRaw.mockResolvedValue([{ id: 'replacement-invitation-1' }]);
    transaction.secretaryReplacementInvitation.findUnique.mockResolvedValue({
      id: 'replacement-invitation-1',
      practiceLocationId: 'location-1',
      invitedByUserId: 'doctor-1',
      replacementForPracticeStaffId: 'incumbent-staff-1',
      normalizedEmail: 'ana@example.com',
      firstName: 'Ana', lastName: 'Reyes', mobileNumber: '+639171234567',
      tokenHash, activeInvitationKey: 'active-key', status: SecretaryInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocation: {
        id: 'location-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'incumbent-staff-1',
      },
    });
    transaction.user.create.mockResolvedValue({ id: 'ana-user-1' });
    transaction.secretaryReplacementInvitation.update.mockResolvedValue({});
    transaction.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.accept({ token, password: 'Replacement candidate password' })).resolves.toEqual({
      accepted: true,
      assignmentPendingDoctorConfirmation: true,
    });

    expect(transaction.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: UserRole.SECRETARY, passwordHash: 'password-hash' }),
    }));
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
    expect(transaction.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('rejects acceptance if the clinic incumbent changed after the invitation was issued', async () => {
    const token = 'stale-token';
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    transaction.$queryRaw.mockResolvedValue([{ id: 'replacement-invitation-1' }]);
    transaction.secretaryReplacementInvitation.findUnique.mockResolvedValue({
      id: 'replacement-invitation-1',
      replacementForPracticeStaffId: 'old-incumbent',
      normalizedEmail: 'ana@example.com', firstName: 'Ana', lastName: 'Reyes', mobileNumber: '+639171234567',
      tokenHash, activeInvitationKey: 'active-key', status: SecretaryInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocation: {
        id: 'location-1', lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'different-incumbent',
      },
    });

    await expect(service.accept({ token, password: 'Replacement candidate password' })).rejects.toThrow('Clinic staffing changed');
    expect(transaction.user.create).not.toHaveBeenCalled();
  });
});
