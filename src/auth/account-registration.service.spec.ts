import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AccountRegistrationService } from './account-registration.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordSecurityService } from './security/password-security.service';

const publicRoles = [UserRole.DOCTOR, UserRole.SECRETARY] as const;

describe('AccountRegistrationService', () => {
  const createInitialVerification = jest.fn().mockResolvedValue({
    id: 'verification-1',
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  const mobileNumberService = {
    normalize: jest.fn().mockReturnValue({ canonical: '+639171234567' }),
  } as unknown as MobileNumberService;
  const passwordSecurityService = {
    hash: jest.fn().mockResolvedValue('hashed-password'),
  } as unknown as PasswordSecurityService;
  const emailVerificationService = {
    createInitialVerification,
  } as unknown as EmailVerificationService;

  function buildService(role: (typeof publicRoles)[number]) {
    const userCreate = jest.fn().mockResolvedValue({ id: 'user-1', role });
    const transaction = { user: { create: userCreate } };
    const transactionMock = jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: transactionMock,
    } as unknown as PrismaService;

    return {
      service: new AccountRegistrationService(
        prisma,
        mobileNumberService,
        emailVerificationService,
        passwordSecurityService,
      ),
      userCreate,
      transaction,
      transactionMock,
    };
  }

  it.each(publicRoles)(
    'creates a %s User without clinic authority and requires email verification',
    async (role) => {
      createInitialVerification.mockClear();
      const { service, userCreate, transaction } = buildService(role);

      await expect(
        service.register({
          firstName: ' Maria ',
          lastName: ' Santos ',
          email: ' Person@Example.COM ',
          mobileNumber: '09171234567',
          password: 'secret-pass',
          role,
        }),
      ).resolves.toEqual({
        userId: 'user-1',
        role,
        emailVerificationRequired: true,
        emailVerificationExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
      });

      expect(userCreate).toHaveBeenCalledWith({
        data: {
          firstName: 'Maria',
          middleName: null,
          lastName: 'Santos',
          email: 'person@example.com',
          mobileNumber: '+639171234567',
          passwordHash: 'hashed-password',
          role,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
          emailVerifiedAt: null,
        },
      });
      expect(createInitialVerification).toHaveBeenCalledWith(
        transaction,
        'user-1',
        'person@example.com',
      );
      expect(JSON.stringify(transaction)).not.toContain('practiceStaff');
      expect(JSON.stringify(transaction)).not.toContain('doctorProfile');
    },
  );

  it('rejects an email already used by a current account before creating anything', async () => {
    const transactionMock = jest.fn();
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const service = new AccountRegistrationService(
      prisma,
      mobileNumberService,
      emailVerificationService,
      passwordSecurityService,
    );

    await expect(
      service.register({
        firstName: 'Maria',
        lastName: 'Santos',
        email: 'existing@example.com',
        mobileNumber: '09171234567',
        password: 'secret-pass',
        role: UserRole.SECRETARY,
      }),
    ).rejects.toThrow('A current account already uses this email.');
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
