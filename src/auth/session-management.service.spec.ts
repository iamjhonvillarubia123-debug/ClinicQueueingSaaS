import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordSecurityService } from './security/password-security.service';
import { SessionManagementService } from './session-management.service';

describe('SessionManagementService', () => {
  const actor = {
    userId: 'doctor-1',
    sessionId: 'current-session',
    role: UserRole.DOCTOR,
  };
  const transaction = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    userSession: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const passwords = { verify: jest.fn() };
  const service = new SessionManagementService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordSecurityService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.$queryRaw.mockResolvedValue([{ id: actor.userId }]);
    transaction.user.findUnique.mockResolvedValue({
      id: actor.userId,
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      emailVerifiedAt: new Date(),
      passwordHash: 'private-hash',
    });
    transaction.userSession.findFirst.mockResolvedValue({
      id: actor.sessionId,
    });
    transaction.userSession.findMany.mockResolvedValue([
      {
        id: actor.sessionId,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(),
        idleExpiresAt: new Date(),
      },
    ]);
    transaction.userSession.updateMany.mockResolvedValue({ count: 2 });
    passwords.verify.mockResolvedValue(true);
  });
  it('lists only owned live sessions using an explicit safe field selection', async () => {
    const result = await service.list(actor);
    expect(result.sessions[0].isCurrent).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-hash');
    expect(transaction.userSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: actor.userId,
          revokedAt: null,
          idleExpiresAt: { gt: expect.any(Date) as Date },
          expiresAt: { gt: expect.any(Date) as Date },
        },
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          idleExpiresAt: true,
        },
      }),
    );
  });
  it('rejects another role in the service, not just in the UI', async () => {
    await expect(
      service.list({ ...actor, role: UserRole.SECRETARY }),
    ).rejects.toThrow(ForbiddenException);
    expect(transaction.userSession.findMany).not.toHaveBeenCalled();
  });
  it.each(['VOLUNTARILY_DISABLED', 'PERMANENTLY_CLOSED'])(
    'rejects an account that became %s after the guard',
    async (status) => {
      transaction.user.findUnique.mockResolvedValue({
        role: 'DOCTOR',
        accountStatus: status,
      });
      await expect(service.revokeOthers(actor, 'password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rejects a revoked, expired, or unrelated current session', async () => {
    transaction.userSession.findFirst.mockResolvedValue(null);
    await expect(service.revokeOne(actor, 'target')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('does not allow revoking another Doctor’s session', async () => {
    transaction.userSession.findFirst
      .mockResolvedValueOnce({ id: actor.sessionId })
      .mockResolvedValueOnce(null);
    await expect(service.revokeOne(actor, 'foreign-session')).rejects.toThrow(
      NotFoundException,
    );
    expect(transaction.userSession.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'foreign-session', userId: actor.userId },
      select: { id: true },
    });
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('never revokes the current session through these endpoints', async () => {
    await expect(service.revokeOne(actor, actor.sessionId)).rejects.toThrow(
      BadRequestException,
    );
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('requires the current password before ending other sessions', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(service.revokeOthers(actor, 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('revokes only other active sessions belonging to the Doctor', async () => {
    expect(await service.revokeOthers(actor, 'correct')).toEqual({
      revokedCount: 2,
    });
    expect(passwords.verify).toHaveBeenCalledWith('correct', 'private-hash');
    expect(transaction.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: actor.userId,
        id: { not: actor.sessionId },
        revokedAt: null,
        idleExpiresAt: { gt: expect.any(Date) as Date },
        expiresAt: { gt: expect.any(Date) as Date },
      },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
  it('fails without a mutation if the current session expires during verification', async () => {
    transaction.userSession.findFirst
      .mockResolvedValueOnce({ id: actor.sessionId })
      .mockResolvedValueOnce(null);
    await expect(service.revokeOthers(actor, 'correct')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(transaction.userSession.updateMany).not.toHaveBeenCalled();
  });
  it('makes repeated individual revocation harmless', async () => {
    transaction.userSession.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.revokeOne(actor, 'target')).toEqual({
      revoked: true,
      changed: false,
    });
  });
});
