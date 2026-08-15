import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import {
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
} from './security/session-security';

export interface LoginResult {
  sessionToken: string;
  response: {
    user: { id: string; role: UserRole };
    lastLoginAt: Date;
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(loginDto: LoginDto): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(loginDto.email);

    const user = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
    });

    const passwordMatches = user
      ? await bcrypt.compare(loginDto.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches || !this.isOrdinaryLoginEligible(user)) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_LIFETIME_MS);
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.userSession.create({
        data: {
          userId: user.id,
          tokenHash,
          lastSeenAt: now,
          idleExpiresAt,
          expiresAt,
          revokedAt: null,
        },
      });

      await transaction.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
      });
    });

    return {
      sessionToken,
      response: {
        user: { id: user.id, role: user.role },
        lastLoginAt: now,
      },
    };
  }

  private isOrdinaryLoginEligible(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    emailVerifiedAt: Date | null;
  }): boolean {
    if (user.accountStatus !== UserAccountStatus.ACTIVE) return false;

    if (
      user.administrativeRestrictionStatus !==
      AdministrativeRestrictionStatus.NONE
    ) {
      return false;
    }

    if (
      (user.role === UserRole.DOCTOR || user.role === UserRole.SECRETARY) &&
      user.emailVerifiedAt === null
    ) {
      return false;
    }

    return true;
  }
}
