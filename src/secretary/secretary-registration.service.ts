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
    const mobileNumber = this.mobileNumberService.normalize(
      dto.mobileNumber,
    ).canonical;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            firstName: dto.firstName.trim(),
            middleName: this.optionalTrim(dto.middleName),
            lastName: dto.lastName.trim(),
            email: normalizedEmail,
            mobileNumber,
            passwordHash,
            role: UserRole.SECRETARY,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
          },
        });
        const verification =
          await this.emailVerificationService.createInitialVerification(
            transaction,
            user.id,
            normalizedEmail,
          );

        // Clinic access is intentionally absent. Doctors grant it later by
        // creating independent PracticeStaff assignments for this user.
        return {
          userId: user.id,
          role: UserRole.SECRETARY,
          emailVerificationRequired: true,
          emailVerificationExpiresAt: verification.expiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A current account already uses this email.',
        );
      }
      throw error;
    }
  }

  private optionalTrim(value: string | undefined): string | null {
    if (value === undefined) return null;
    return value.trim() || null;
  }
}
