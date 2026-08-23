import { ConflictException, Injectable } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { EmailVerificationService } from '../auth/email-verification.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { normalizeEmail } from '../auth/security/session-security';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { RegisterSecretaryDto } from './dto/register-secretary.dto';

@Injectable()
export class SecretaryRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async register(dto: RegisterSecretaryDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const firstName = dto.firstName.trim();
    const middleName = this.optionalTrim(dto.middleName);
    const lastName = dto.lastName.trim();
    const mobileNumber = this.mobileNumberService.normalize(dto.mobileNumber).canonical;

    const existingCurrentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (existingCurrentUser) {
      throw new ConflictException('A current account already uses this email.');
    }

    const passwordHash = await this.passwordSecurityService.hash(dto.password);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            firstName,
            middleName,
            lastName,
            email: normalizedEmail,
            mobileNumber,
            passwordHash,
            role: UserRole.SECRETARY,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
          },
        });

        const emailVerification =
          await this.emailVerificationService.createInitialVerification(
            transaction,
            user.id,
            normalizedEmail,
            UserRole.SECRETARY,
          );

        return {
          userId: user.id,
          role: UserRole.SECRETARY,
          emailVerificationRequired: true,
          emailVerificationExpiresAt: emailVerification.expiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A current account already uses this email.');
      }
      throw error;
    }
  }

  private optionalTrim(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }
}
