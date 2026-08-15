import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashSessionToken,
  SESSION_IDLE_LIFETIME_MS,
  SESSION_TOUCH_THROTTLE_MS,
} from './security/session-security';
import type { AuthenticatedUserContext } from './types/authenticated-request';

@Injectable()
export class AuthenticationService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticateOrdinarySession(
    rawToken: string,
  ): Promise<AuthenticatedUserContext> {
    const now = new Date();
    const tokenHash = hashSessionToken(rawToken);

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt !== null ||
      now >= session.idleExpiresAt ||
      now >= session.expiresAt
    ) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = session.user;

    if (user.accountStatus !== UserAccountStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (
      user.role === UserRole.DOCTOR &&
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (
      user.role === UserRole.SECRETARY &&
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new UnauthorizedException('Authentication required.');
    }

    await this.touchSessionIfNeeded(
      session.id,
      session.lastSeenAt,
      session.idleExpiresAt,
      session.expiresAt,
      now,
    );

    return {
      userId: user.id,
      role: user.role,
      sessionId: session.id,
    };
  }

  private async touchSessionIfNeeded(
    sessionId: string,
    lastSeenAt: Date,
    idleExpiresAt: Date,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    if (now.getTime() - lastSeenAt.getTime() < SESSION_TOUCH_THROTTLE_MS) {
      return;
    }

    const candidateIdleExpiry = new Date(
      now.getTime() + SESSION_IDLE_LIFETIME_MS,
    );
    const newIdleExpiry =
      candidateIdleExpiry < expiresAt ? candidateIdleExpiry : expiresAt;

    if (newIdleExpiry <= idleExpiresAt && now <= lastSeenAt) {
      return;
    }

    await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        expiresAt: { gt: now },
      },
      data: {
        lastSeenAt: now,
        idleExpiresAt: newIdleExpiry,
      },
    });
  }
}
