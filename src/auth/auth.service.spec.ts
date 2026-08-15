import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import {
  hashSessionToken,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
} from './security/session-security';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

const bcryptCompare = bcrypt.compare as jest.MockedFunction<
  typeof bcrypt.compare
>;

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

  const eligibleDoctor = () => ({
    id: 'user-1',
    email: 'doctor@example.com',
    passwordHash: 'hash',
    role: UserRole.DOCTOR,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    emailVerifiedAt: new Date(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  it('rejects missing account with generic error and creates no session', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue(null);
    await expect(
      service.login({ email: ' Missing@Example.com ', password: 'x' }),
    ).rejects.toThrow('Invalid email or password.');
    expect(prismaServiceMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'missing@example.com',
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
    });
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });

  it('creates a fresh opaque hashed session with exact idle and absolute lifetimes', async () => {
    const user = eligibleDoctor();
    prismaServiceMock.user.findFirst.mockResolvedValue(user);
    transactionMock.user.findUnique.mockResolvedValue(user);
    bcryptCompare.mockResolvedValue(true as never);

    const result = await service.login({
      email: 'doctor@example.com',
      password: 'CorrectPassword123!',
    });

    expect(result.sessionToken).toBeTruthy();
    expect(result.sessionToken).not.toBe(
      (result.response as Record<string, unknown>).sessionToken,
    );
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
    bcryptCompare.mockResolvedValue(true as never);

    await expect(
      service.login({ email: user.email, password: 'CorrectPassword123!' }),
    ).rejects.toThrow('Invalid email or password.');
    expect(transactionMock.userSession.create).not.toHaveBeenCalled();
    expect(transactionMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects unverified doctor without creating a session', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue({
      ...eligibleDoctor(),
      emailVerifiedAt: null,
    });
    bcryptCompare.mockResolvedValue(true as never);
    await expect(
      service.login({ email: 'doctor@example.com', password: 'x' }),
    ).rejects.toThrow('Invalid email or password.');
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
