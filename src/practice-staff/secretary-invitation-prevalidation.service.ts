import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import {
  accountIdentifierIsVerified,
  parseAccountIdentifier,
} from '../auth/security/account-identifier';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';

@Injectable()
export class SecretaryInvitationPrevalidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordSecurityService,
    private readonly mobileNumbers: MobileNumberService,
  ) {}

  async validateIdentifier(
    actorUserId: string,
    practiceLocationId: string,
    identifierInput: string,
  ) {
    const identifier = parseAccountIdentifier(identifierInput, this.mobileNumbers);
    await this.assertEligibleDoctorOwnsLocation(actorUserId, practiceLocationId);

    const target = await this.prisma.user.findFirst({
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
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!target) {
      throw new NotFoundException(
        'No current eligible Secretary account was found for this email address or mobile number. Ask the Secretary to create and verify a new account before continuing.',
      );
    }

    if (target.role !== UserRole.SECRETARY) {
      throw new ConflictException(
        'This email address or mobile number belongs to an account with an incompatible role.',
      );
    }

    if (target.accountStatus === UserAccountStatus.VOLUNTARILY_DISABLED) {
      throw new ConflictException(
        'This Secretary account is currently disabled. Ask the Secretary to reactivate the account before continuing.',
      );
    }

    if (
      target.accountStatus !== UserAccountStatus.ACTIVE ||
      target.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ConflictException(
        'This Secretary account is not currently eligible to receive a clinic invitation.',
      );
    }

    if (!accountIdentifierIsVerified(target)) {
      throw new ConflictException(
        'The Secretary must verify the email address or mobile number used to sign in before continuing.',
      );
    }

    return {
      valid: true as const,
      existingSecretary: true,
      secretaryName: `${target.firstName ?? ''} ${target.lastName ?? ''}`.trim() || null,
    };
  }

  async validateAuthorization(
    actorUserId: string,
    practiceLocationId: string,
    password: string,
  ) {
    const actor = await this.assertEligibleDoctorOwnsLocation(
      actorUserId,
      practiceLocationId,
      true,
    );

    if (!(await this.passwords.verify(password, actor.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    return { valid: true as const };
  }

  private async assertEligibleDoctorOwnsLocation(
    actorUserId: string,
    practiceLocationId: string,
    includePassword = false,
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        ...(includePassword ? { passwordHash: true } : {}),
      },
    });

    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible current Doctor may validate a Secretary invitation.',
      );
    }

    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
        doctorProfile: { userId: actorUserId },
      },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }

    return actor as typeof actor & { passwordHash: string };
  }
}
