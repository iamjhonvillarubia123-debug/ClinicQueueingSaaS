import {
  BadRequestException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordSecurityService } from '../security/password-security.service';
import { CurrentPasswordGuard } from './current-password.guard';

describe('CurrentPasswordGuard', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
  };
  const passwordSecurity = {
    verify: jest.fn(),
  };
  const guard = new CurrentPasswordGuard(
    prisma as unknown as PrismaService,
    passwordSecurity as unknown as PasswordSecurityService,
  );

  function context(body: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'doctor-1', role: 'DOCTOR', sessionId: 'session-1' },
          body,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' });
    passwordSecurity.verify.mockResolvedValue(true);
  });

  it('allows a sensitive action only when the current password matches', async () => {
    await expect(
      guard.canActivate(context({ currentPassword: 'correct password' })),
    ).resolves.toBe(true);
    expect(passwordSecurity.verify).toHaveBeenCalledWith(
      'correct password',
      'stored-hash',
    );
  });

  it('rejects an incorrect current password before the command can run', async () => {
    passwordSecurity.verify.mockResolvedValue(false);

    await expect(
      guard.canActivate(context({ currentPassword: 'wrong password' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a missing current password before the command can run', async () => {
    await expect(guard.canActivate(context({}))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(passwordSecurity.verify).not.toHaveBeenCalled();
  });
});
