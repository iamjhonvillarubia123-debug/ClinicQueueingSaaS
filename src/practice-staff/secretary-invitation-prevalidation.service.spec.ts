import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { SecretaryInvitationPrevalidationService } from './secretary-invitation-prevalidation.service';

describe('SecretaryInvitationPrevalidationService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    practiceLocation: {
      findFirst: jest.fn(),
    },
  };
  const passwords = {
    verify: jest.fn(),
  };
  const mobileNumbers = {
    normalize: jest.fn(),
    hashCanonical: jest.fn(),
  };

  const activeDoctor = {
    role: UserRole.DOCTOR,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    passwordHash: 'doctor-hash',
  };
  const activeSecretary = {
    id: 'secretary-1',
    role: UserRole.SECRETARY,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    loginIdentifierType: 'EMAIL' as const,
    emailVerifiedAt: new Date(),
    mobileVerifiedAt: null,
    firstName: 'Ana',
    lastName: 'Secretary',
  };

  let service: SecretaryInvitationPrevalidationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(activeDoctor);
    prisma.practiceLocation.findFirst.mockResolvedValue({ id: 'clinic-1' });
    prisma.user.findFirst.mockResolvedValue(activeSecretary);
    passwords.verify.mockResolvedValue(true);
    service = new SecretaryInvitationPrevalidationService(
      prisma as never,
      passwords as never,
      mobileNumbers as never,
    );
  });

  it('allows an active verified Secretary to continue', async () => {
    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-1',
        'ana@example.test',
      ),
    ).resolves.toEqual({
      valid: true,
      existingSecretary: true,
      secretaryName: 'Ana Secretary',
    });
  });

  it('stops a permanently closed or otherwise non-current identifier before authority setup', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-1',
        'closed@example.test',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops a voluntarily disabled Secretary and directs reactivation', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
    });

    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-1',
        'disabled@example.test',
      ),
    ).rejects.toThrow('currently disabled');
  });

  it('stops an unverified Secretary before authority setup', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      emailVerifiedAt: null,
    });

    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-1',
        'unverified@example.test',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an incompatible current account role', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...activeSecretary,
      role: UserRole.DOCTOR,
    });

    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-1',
        'doctor@example.test',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not validate a Secretary for a clinic the Doctor does not own', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.validateIdentifier(
        'doctor-1',
        'clinic-other',
        'ana@example.test',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the correct Doctor password before sensitive invitation review', async () => {
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.validateAuthorization('doctor-1', 'clinic-1', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwords.verify).toHaveBeenCalledWith(
      'wrong-password',
      'doctor-hash',
    );
  });
});
