import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AuthService } from './auth.service';
import { PasswordSecurityService } from './security/password-security.service';
import {
  hashSessionToken,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
} from './security/session-security';

type SessionCreateArgs = {
  data: {
    userId: string;
    tokenHash: string;
    lastSeenAt: Date;
    idleExpiresAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  };
};

describe('AuthService', () => {
  let service: AuthService;
  const transactionMock = {
    userSession: {
      create: jest.fn((args: SessionCreateArgs) => Promise.resolve(args)),
    },
    user: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prismaServiceMock = {
    user: { findFirst: jest.fn() },
    userSession: { updateMany: jest.fn() },
    $transaction: jest.fn(
      async (callback: (tx: typeof transactionMock) => Promise<void>) =>
        callback(transactionMock),
    ),
  };
  const passwordSecurityServiceMock = {
    verify: jest.fn(),
  };
  const mobileNumberServiceMock = {
    normalize: jest.fn((value: string) => ({ canonical: value })),
    hashCanonical: jest.fn((value: string) => `hash:${value}`),
  };

  const eligibleDoctor = () => ({
    id: 'user-1',
    email: 'doctor@example.com',
    mobileNumberHash: null,
    passwordHash: 'hash',
    role: UserRole.DOCTOR,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    loginIdentifierType: AccountLoginIdentifierType.EMAIL,
    emailVerifiedAt: new Date(),
    mobileVerifiedAt: null,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaServiceMock },
        {
          provide: PasswordSecurityService,
          useValue: passwordSecurityServiceMock,
        },
        { provide: MobileNumberService, useValue: mobileNumberServiceMock },
      ],
    }).compile();
    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  it('rejects missing account with generic error and creates no session', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue(null);
    await expect(
      service.login({ identifier: ' Missing@Example.com ', password: 'x' }),
    ).rejects.toThrow('Invalid login details or password.');
    expect(prismaServiceMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        loginIdentifierType: AccountLoginIdentifierType.EMAIL,
        email: 'missing@example.com',
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
    });
    expect(passwordSecurityServiceMock.verify).not.toHaveBeenCalled();
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });

  it('creates a fresh opaque hashed session with exact idle and absolute lifetimes', async () => {
    const user = eligibleDoctor();
    prismaServiceMock.user.findFirst.mockResolvedValue(user);
    transactionMock.user.findUnique.mockResolvedValue(user);
    passwordSecurityServiceMock.verify.mockResolvedValue(true);

    const result = await service.login({
      identifier: 'doctor@example.com',
      password: 'CorrectPassword123!',
    });

    expect(passwordSecurityServiceMock.verify).toHaveBeenCalledWith(
      'CorrectPassword123!',
      'hash',
    );
    expect(result.sessionToken).toBeTruthy();
    expect(transactionMock.userSession.create).toHaveBeenCalledTimes(1);
    const data = transactionMock.userSession.create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-1');
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.tokenHash).not.toBe(result.sessionToken);
    expect(data.revokedAt).toBeNull();
    expect(data.idleExpiresAt.getTime() - data.lastSeenAt.getTime()).toBe(
      SESSION_IDLE_LIFETIME_MS,
    );
    expect(data.expiresAt.getTime() - data.lastSeenAt.getTime()).toBe(
      SESSION_ABSOLUTE_LIFETIME_MS,
    );
    expect(transactionMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: data.lastSeenAt },
    });
  });

  it('revalidates current User state inside the login transaction before creating a session', async () => {
    const user = eligibleDoctor();
    prismaServiceMock.user.findFirst.mockResolvedValue(user);
    transactionMock.user.findUnique.mockResolvedValue({
      ...user,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
    });
    passwordSecurityServiceMock.verify.mockResolvedValue(true);

    await expect(
      service.login({ identifier: user.email, password: 'CorrectPassword123!' }),
    ).rejects.toThrow('Invalid login details or password.');
    expect(transactionMock.userSession.create).not.toHaveBeenCalled();
    expect(transactionMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unverified account without creating a sign-in session', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue({
      ...eligibleDoctor(),
      emailVerifiedAt: null,
    });
    passwordSecurityServiceMock.verify.mockResolvedValue(true);

    await expect(
      service.login({ identifier: 'doctor@example.com', password: 'x' }),
    ).rejects.toThrow('Invalid login details or password.');
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });

  it('revokes only the session identified by the logout cookie token', async () => {
    prismaServiceMock.userSession.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.logout('raw-session-token')).resolves.toEqual({
      loggedOut: true,
    });

    expect(prismaServiceMock.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashSessionToken('raw-session-token'),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) as unknown },
    });
  });

  it('makes logout idempotently succeed without a usable cookie', async () => {
    await expect(service.logout(null)).resolves.toEqual({ loggedOut: true });
    expect(prismaServiceMock.userSession.updateMany).not.toHaveBeenCalled();
  });
});
