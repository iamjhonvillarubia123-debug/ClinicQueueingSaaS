import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { LoginDto } from './dto/login.dto';
import { PasswordSecurityService } from './security/password-security.service';
import {
  accountIdentifierIsVerified,
  parseAccountIdentifier,
} from './security/account-identifier';
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
} from './security/session-security';

export type LoginResult =
  | {
      sessionToken: string;
      response: {
        user: { id: string; role: UserRole };
        lastLoginAt: Date;
      };
    }
  | {
      sessionToken: null;
      response: {
        verificationRequired: true;
        verificationChannel: 'EMAIL' | 'MOBILE';
        userId: string;
        role: UserRole;
      };
    };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly mobileNumberService: MobileNumberService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResult> {
    const identifier = parseAccountIdentifier(
      loginDto.identifier,
      this.mobileNumberService,
    );

    const user = await this.prisma.user.findFirst({
      where: {
        ...(identifier.type === 'EMAIL'
          ? {
              loginIdentifierType: AccountLoginIdentifierType.EMAIL,
              email: identifier.normalized,
            }
          : {
              loginIdentifierType: AccountLoginIdentifierType.MOBILE,
              mobileNumberHash: identifier.mobileHash,
            }),
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
    });

    const passwordMatches = user
      ? await this.passwordSecurityService.verify(
          loginDto.password,
          user.passwordHash,
        )
      : false;

    if (!user || !passwordMatches || !this.isBaseLoginEligible(user)) {
      throw new UnauthorizedException('Invalid login details or password.');
    }

    if (
      (user.role === UserRole.DOCTOR || user.role === UserRole.SECRETARY) &&
      !accountIdentifierIsVerified(user)
    ) {
      return {
        sessionToken: null,
        response: {
          verificationRequired: true,
          verificationChannel:
            user.loginIdentifierType === AccountLoginIdentifierType.EMAIL
              ? 'EMAIL'
              : 'MOBILE',
          userId: user.id,
          role: user.role,
        },
      };
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_LIFETIME_MS);
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);

    await this.prisma.$transaction(async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { id: user.id },
      });

      if (
        !currentUser ||
        currentUser.passwordHash !== user.passwordHash ||
        !this.isOrdinaryLoginEligible(currentUser)
      ) {
        throw new UnauthorizedException('Invalid login details or password.');
      }

      await transaction.userSession.create({
        data: {
          userId: currentUser.id,
          tokenHash,
          lastSeenAt: now,
          idleExpiresAt,
          expiresAt,
          revokedAt: null,
        },
      });

      await transaction.user.update({
        where: { id: currentUser.id },
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

  async logout(rawSessionToken: string | null): Promise<{ loggedOut: true }> {
    if (rawSessionToken) {
      const tokenHash = hashSessionToken(rawSessionToken);
      await this.prisma.userSession.updateMany({
        where: {
          tokenHash,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    return { loggedOut: true };
  }

  private isBaseLoginEligible(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  }): boolean {
    if (user.accountStatus !== UserAccountStatus.ACTIVE) return false;

    if (
      user.role === UserRole.DOCTOR &&
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      return false;
    }

    return true;
  }

  private isOrdinaryLoginEligible(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    loginIdentifierType: AccountLoginIdentifierType;
    emailVerifiedAt: Date | null;
    mobileVerifiedAt: Date | null;
  }): boolean {
    if (!this.isBaseLoginEligible(user)) return false;

    if (
      (user.role === UserRole.DOCTOR || user.role === UserRole.SECRETARY) &&
      !accountIdentifierIsVerified(user)
    ) {
      return false;
    }

    return true;
  }
}
