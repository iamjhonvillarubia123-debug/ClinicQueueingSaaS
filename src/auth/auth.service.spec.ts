import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

const bcryptCompare = bcrypt.compare as jest.MockedFunction<
  typeof bcrypt.compare
>;

describe('AuthService', () => {
  let service: AuthService;
  const transactionMock = {
    userSession: { create: jest.fn() },
    user: { update: jest.fn() },
  };
  const prismaServiceMock = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(
      async (callback: (tx: typeof transactionMock) => Promise<void>) =>
        callback(transactionMock),
    ),
  };

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

  it('creates opaque hashed session and omits raw token from response body', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'doctor@example.com',
      passwordHash: 'hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      emailVerifiedAt: new Date(),
    });
    bcryptCompare.mockResolvedValue(true as never);

    const result = await service.login({
      email: 'doctor@example.com',
      password: 'CorrectPassword123!',
    });

    expect(result.sessionToken).toBeTruthy();
    expect(result.sessionToken).not.toBe(
      (result.response as Record<string, unknown>).sessionToken,
    );
    expect(transactionMock.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        revokedAt: null,
      }) as unknown,
    });
    expect(transactionMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { lastLoginAt: expect.any(Date) as unknown },
    });
    expect(result.response).toEqual(
      expect.objectContaining({
        user: { id: 'user-1', role: UserRole.DOCTOR },
      }),
    );
  });

  it('rejects unverified doctor without creating a session', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      emailVerifiedAt: null,
    });
    bcryptCompare.mockResolvedValue(true as never);
    await expect(
      service.login({ email: 'doctor@example.com', password: 'x' }),
    ).rejects.toThrow('Invalid email or password.');
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
