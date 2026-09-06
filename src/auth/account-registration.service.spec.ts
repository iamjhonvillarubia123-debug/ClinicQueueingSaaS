import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AccountMobileVerificationService } from './account-mobile-verification.service';
import { AccountRegistrationService } from './account-registration.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordSecurityService } from './security/password-security.service';

describe('AccountRegistrationService', () => {
  const emailVerificationService = {
    createInitialVerification: jest.fn().mockResolvedValue({
      id: 'email-verification-1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    }),
  } as unknown as EmailVerificationService;
  const mobileVerificationService = {
    createInitialVerification: jest.fn().mockResolvedValue({
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    }),
  } as unknown as AccountMobileVerificationService;
  const mobileNumberService = {
    normalize: jest.fn().mockReturnValue({ canonical: '639171234567' }),
    hashCanonical: jest.fn().mockReturnValue('mobile-hash'),
  } as unknown as MobileNumberService;
  const passwordSecurityService = {
    hash: jest.fn().mockResolvedValue('hashed-password'),
    verify: jest.fn().mockResolvedValue(false),
  } as unknown as PasswordSecurityService;

  function buildService(existing: unknown = null) {
    const userCreate = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 'user-1', role: data.role }),
    );
    const transaction = { user: { create: userCreate } };
    const transactionMock = jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: transactionMock,
    } as unknown as PrismaService;

    return {
      service: new AccountRegistrationService(
        prisma,
        mobileNumberService,
        emailVerificationService,
        mobileVerificationService,
        passwordSecurityService,
      ),
      userCreate,
      transaction,
      transactionMock,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (mobileNumberService.normalize as jest.Mock).mockReturnValue({
      canonical: '639171234567',
    });
    (mobileNumberService.hashCanonical as jest.Mock).mockReturnValue('mobile-hash');
    (passwordSecurityService.hash as jest.Mock).mockResolvedValue('hashed-password');
    (passwordSecurityService.verify as jest.Mock).mockResolvedValue(false);
    (emailVerificationService.createInitialVerification as jest.Mock).mockResolvedValue({
      id: 'email-verification-1',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    (mobileVerificationService.createInitialVerification as jest.Mock).mockResolvedValue({
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('creates a Doctor email account without clinic authority and requires verification', async () => {
    const { service, userCreate, transaction } = buildService();

    await expect(
      service.register({
        firstName: ' Maria ',
        lastName: ' Santos ',
        identifier: ' Person@Example.COM ',
        password: 'secret-pass',
        role: UserRole.DOCTOR,
      }),
    ).resolves.toEqual({
      registrationStatus: 'CREATED',
      userId: 'user-1',
      role: UserRole.DOCTOR,
      verificationChannel: 'EMAIL',
      verificationRequired: true,
      verificationExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(userCreate).toHaveBeenCalledWith({
      data: {
        firstName: 'Maria',
        middleName: null,
        lastName: 'Santos',
        email: 'person@example.com',
        mobileNumber: null,
        mobileNumberHash: null,
        loginIdentifierType: AccountLoginIdentifierType.EMAIL,
        passwordHash: 'hashed-password',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: null,
        mobileVerifiedAt: null,
      },
    });
    expect(emailVerificationService.createInitialVerification).toHaveBeenCalledWith(
      transaction,
      'user-1',
      'person@example.com',
    );
    expect(JSON.stringify(transaction)).not.toContain('practiceStaff');
  });

  it('creates a Secretary mobile account without clinic authority and requires verification', async () => {
    const { service, transaction } = buildService();

    await expect(
      service.register({
        firstName: 'Ana',
        lastName: 'Reyes',
        identifier: '09171234567',
        password: 'secret-pass',
        role: UserRole.SECRETARY,
      }),
    ).resolves.toEqual({
      registrationStatus: 'CREATED',
      userId: 'user-1',
      role: UserRole.SECRETARY,
      verificationChannel: 'MOBILE',
      verificationRequired: true,
      verificationExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(mobileVerificationService.createInitialVerification).toHaveBeenCalledWith(
      transaction,
      'user-1',
      '639171234567',
      'mobile-hash',
    );
    expect(JSON.stringify(transaction)).not.toContain('practiceStaff');
  });

  it('returns mobile verification continuation when an existing unverified account password matches', async () => {
    const existing = {
      id: 'existing-user',
      passwordHash: 'existing-hash',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      loginIdentifierType: AccountLoginIdentifierType.MOBILE,
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
    };
    (passwordSecurityService.verify as jest.Mock).mockResolvedValue(true);
    const { service, transactionMock } = buildService(existing);

    await expect(
      service.register({
        firstName: 'Different',
        lastName: 'Values',
        identifier: '09171234567',
        password: 'correct-password',
        role: UserRole.DOCTOR,
      }),
    ).resolves.toEqual({
      registrationStatus: 'VERIFICATION_PENDING',
      userId: 'existing-user',
      role: UserRole.SECRETARY,
      verificationChannel: 'MOBILE',
      verificationRequired: true,
    });

    expect(passwordSecurityService.verify).toHaveBeenCalledWith(
      'correct-password',
      'existing-hash',
    );
    expect(transactionMock).not.toHaveBeenCalled();
    expect(passwordSecurityService.hash).not.toHaveBeenCalled();
  });

  it('returns email verification continuation for a matching unverified email account', async () => {
    const existing = {
      id: 'existing-user',
      passwordHash: 'existing-hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      loginIdentifierType: AccountLoginIdentifierType.EMAIL,
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
    };
    (passwordSecurityService.verify as jest.Mock).mockResolvedValue(true);
    const { service } = buildService(existing);

    await expect(
      service.register({
        firstName: 'Maria',
        lastName: 'Santos',
        identifier: 'doctor@example.com',
        password: 'correct-password',
        role: UserRole.DOCTOR,
      }),
    ).resolves.toMatchObject({
      registrationStatus: 'VERIFICATION_PENDING',
      userId: 'existing-user',
      role: UserRole.DOCTOR,
      verificationChannel: 'EMAIL',
      verificationRequired: true,
    });
  });

  it('keeps the duplicate-account conflict when the existing password does not match', async () => {
    const existing = {
      id: 'existing-user',
      passwordHash: 'existing-hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      loginIdentifierType: AccountLoginIdentifierType.EMAIL,
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
    };
    const { service, transactionMock } = buildService(existing);

    await expect(
      service.register({
        firstName: 'Maria',
        lastName: 'Santos',
        identifier: 'doctor@example.com',
        password: 'wrong-password',
        role: UserRole.DOCTOR,
      }),
    ).rejects.toThrow(
      'A current account already uses this email address or mobile number.',
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('does not offer registration continuation for an already verified account', async () => {
    const existing = {
      id: 'existing-user',
      passwordHash: 'existing-hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      loginIdentifierType: AccountLoginIdentifierType.EMAIL,
      emailVerifiedAt: new Date(),
      mobileVerifiedAt: null,
    };
    (passwordSecurityService.verify as jest.Mock).mockResolvedValue(true);
    const { service } = buildService(existing);

    await expect(
      service.register({
        firstName: 'Maria',
        lastName: 'Santos',
        identifier: 'doctor@example.com',
        password: 'correct-password',
        role: UserRole.DOCTOR,
      }),
    ).rejects.toThrow(
      'A current account already uses this email address or mobile number.',
    );
  });
});
