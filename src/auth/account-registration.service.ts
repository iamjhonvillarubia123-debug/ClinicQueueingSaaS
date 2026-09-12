import { ConflictException, Injectable } from '@nestjs/common';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AccountMobileVerificationService } from './account-mobile-verification.service';
import { RegisterAccountDto } from './dto/register-account.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordSecurityService } from './security/password-security.service';
import {
  accountIdentifierIsVerified,
  parseAccountIdentifier,
} from './security/account-identifier';

@Injectable()
export class AccountRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly mobileVerificationService: AccountMobileVerificationService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async register(dto: RegisterAccountDto) {
    const identifier = parseAccountIdentifier(
      dto.identifier,
      this.mobileNumberService,
    );
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();

    const existingCurrentUser = await this.prisma.user.findFirst({
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
        passwordHash: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
      },
    });

    if (existingCurrentUser) {
      const passwordMatches = await this.passwordSecurityService.verify(
        dto.password,
        existingCurrentUser.passwordHash,
      );
      const publicRole =
        existingCurrentUser.role === UserRole.DOCTOR ||
        existingCurrentUser.role === UserRole.SECRETARY;
      const baseEligible =
        existingCurrentUser.accountStatus === UserAccountStatus.ACTIVE &&
        (existingCurrentUser.role !== UserRole.DOCTOR ||
          existingCurrentUser.administrativeRestrictionStatus ===
            AdministrativeRestrictionStatus.NONE);

      if (
        passwordMatches &&
        publicRole &&
        baseEligible &&
        !accountIdentifierIsVerified(existingCurrentUser)
      ) {
        return {
          registrationStatus: 'VERIFICATION_PENDING' as const,
          userId: existingCurrentUser.id,
          role: existingCurrentUser.role,
          verificationChannel:
            existingCurrentUser.loginIdentifierType ===
            AccountLoginIdentifierType.EMAIL
              ? ('EMAIL' as const)
              : ('MOBILE' as const),
          verificationRequired: true as const,
        };
      }

      throw new ConflictException(
        'A current account already uses this email address or mobile number.',
      );
    }

    const passwordHash = await this.passwordSecurityService.hash(dto.password);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            firstName,
            middleName: null,
            lastName,
            email: identifier.type === 'EMAIL' ? identifier.normalized : null,
            mobileNumber:
              identifier.type === 'MOBILE' ? identifier.normalized : null,
            mobileNumberHash:
              identifier.type === 'MOBILE' ? identifier.mobileHash : null,
            loginIdentifierType:
              identifier.type === 'EMAIL'
                ? AccountLoginIdentifierType.EMAIL
                : AccountLoginIdentifierType.MOBILE,
            passwordHash,
            role: dto.role,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
            mobileVerifiedAt: null,
          },
        });

        if (identifier.type === 'EMAIL') {
          const verification =
            await this.emailVerificationService.createInitialVerification(
              transaction,
              user.id,
              identifier.normalized,
            );
          return {
            registrationStatus: 'CREATED' as const,
            userId: user.id,
            role: user.role,
            verificationChannel: 'EMAIL' as const,
            verificationRequired: true as const,
            verificationExpiresAt: verification.expiresAt,
          };
        }

        const verification =
          await this.mobileVerificationService.createInitialVerification(
            transaction,
            user.id,
            identifier.normalized,
            identifier.mobileHash,
          );
        return {
          registrationStatus: 'CREATED' as const,
          userId: user.id,
          role: user.role,
          verificationChannel: 'MOBILE' as const,
          verificationRequired: true as const,
          verificationExpiresAt: verification.expiresAt,
        };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A current account already uses this email address or mobile number.',
        );
      }
      throw error;
    }
  }
}
