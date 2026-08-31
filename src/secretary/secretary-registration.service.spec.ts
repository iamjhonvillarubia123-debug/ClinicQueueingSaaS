import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { EmailVerificationService } from '../auth/email-verification.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { SecretaryRegistrationService } from './secretary-registration.service';

describe('SecretaryRegistrationService', () => {
  let service: SecretaryRegistrationService;
  const transaction = {
    user: { create: jest.fn() },
    practiceStaff: { create: jest.fn() },
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const mobileNumbers = {
    normalize: jest.fn(() => ({ canonical: '+639171234567' })),
  };
  const verifications = { createInitialVerification: jest.fn() };
  const passwords = { hash: jest.fn().mockResolvedValue('secure-hash') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretaryRegistrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MobileNumberService, useValue: mobileNumbers },
        { provide: EmailVerificationService, useValue: verifications },
        { provide: PasswordSecurityService, useValue: passwords },
      ],
    }).compile();
    service = module.get(SecretaryRegistrationService);
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue({ id: 'secretary-1' });
    verifications.createInitialVerification.mockResolvedValue({
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
  });

  it('creates only a verified-pending Secretary identity with no clinic assignment', async () => {
    const result = await service.register({
      firstName: ' Maria ',
      middleName: ' L ',
      lastName: ' Santos ',
      email: ' Maria@Example.COM ',
      mobileNumber: '0917 123 4567',
      password: 'transient-password',
    });

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        firstName: 'Maria',
        middleName: 'L',
        lastName: 'Santos',
        email: 'maria@example.com',
        mobileNumber: '+639171234567',
        passwordHash: 'secure-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: null,
      },
    });
    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();
    expect(verifications.createInitialVerification).toHaveBeenCalledWith(
      transaction,
      'secretary-1',
      'maria@example.com',
    );
    expect(result).toEqual({
      userId: 'secretary-1',
      role: UserRole.SECRETARY,
      emailVerificationRequired: true,
      emailVerificationExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('rejects an email already used by a current account', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.register({
        firstName: 'Maria',
        lastName: 'Santos',
        email: 'maria@example.com',
        mobileNumber: '09171234567',
        password: 'password',
      }),
    ).rejects.toThrow('A current account already uses this email.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
