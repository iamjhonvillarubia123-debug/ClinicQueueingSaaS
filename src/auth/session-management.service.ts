import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordSecurityService } from './security/password-security.service';
import type { AuthenticatedUserContext } from './types/authenticated-request';

const safeSessionFields = {
  id: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  idleExpiresAt: true,
} as const;

@Injectable()
export class SessionManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordSecurityService,
  ) {}

  async list(actor: AuthenticatedUserContext) {
    return this.prisma.$transaction(async (transaction) => {
      await this.validateActor(transaction, actor);
      const sessions = await transaction.userSession.findMany({
        where: this.liveSessions(actor.userId, new Date()),
        select: safeSessionFields,
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
      });
      return {
        sessions: sessions.map((session) => ({
          ...session,
          isCurrent: session.id === actor.sessionId,
        })),
        deviceDetailsAvailable: false,
      };
    });
  }

  async revokeOne(actor: AuthenticatedUserContext, targetSessionId: string) {
    if (targetSessionId === actor.sessionId)
      throw new BadRequestException(
        'Use Sign Out to end your current session.',
      );
    return this.prisma.$transaction(async (transaction) => {
      await this.validateActor(transaction, actor);
      const target = await transaction.userSession.findFirst({
        where: { id: targetSessionId, userId: actor.userId },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Session was not found.');
      const result = await transaction.userSession.updateMany({
        where: {
          ...this.liveSessions(actor.userId, new Date()),
          id: targetSessionId,
        },
        data: { revokedAt: new Date() },
      });
      return { revoked: true, changed: result.count === 1 };
    });
  }

  async revokeOthers(actor: AuthenticatedUserContext, currentPassword: string) {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.validateActor(transaction, actor);
      if (
        !currentPassword ||
        !(await this.passwords.verify(currentPassword, user.passwordHash))
      )
        throw new UnauthorizedException('Current password is incorrect.');
      // Recheck expiry after password verification; the current session is locked.
      await this.requireCurrentSession(transaction, actor);
      const result = await transaction.userSession.updateMany({
        where: {
          ...this.liveSessions(actor.userId, new Date()),
          id: { not: actor.sessionId },
        },
        data: { revokedAt: new Date() },
      });
      return { revokedCount: result.count };
    });
  }

  private liveSessions(userId: string, now: Date) {
    return {
      userId,
      revokedAt: null,
      idleExpiresAt: { gt: now },
      expiresAt: { gt: now },
    };
  }

  private async validateActor(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUserContext,
  ) {
    if (actor.role !== UserRole.DOCTOR)
      throw new ForbiddenException('Doctor authority is required.');
    // Same lock order as account lifecycle commands: account before session.
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
    const user = await transaction.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        emailVerifiedAt: true,
        passwordHash: true,
      },
    });
    if (
      !user ||
      user.role !== UserRole.DOCTOR ||
      user.accountStatus !== UserAccountStatus.ACTIVE ||
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      !user.emailVerifiedAt
    )
      throw new UnauthorizedException('Authentication required.');
    await transaction.$queryRaw`SELECT "id" FROM "UserSession" WHERE "id" = ${actor.sessionId} AND "userId" = ${actor.userId} FOR UPDATE`;
    await this.requireCurrentSession(transaction, actor);
    return user;
  }

  private async requireCurrentSession(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUserContext,
  ) {
    const current = await transaction.userSession.findFirst({
      where: {
        ...this.liveSessions(actor.userId, new Date()),
        id: actor.sessionId,
      },
      select: { id: true },
    });
    if (!current) throw new UnauthorizedException('Authentication required.');
  }
}
