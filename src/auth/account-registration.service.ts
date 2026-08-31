import { ConflictException, Injectable } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { RegisterAccountDto } from './dto/register-account.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordSecurityService } from './security/password-security.service';
import { normalizeEmail } from './security/session-security';

@Injectable()
export class AccountRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async register(dto: RegisterAccountDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const mobileNumber = this.mobileNumberService.normalize(
      dto.mobileNumber,
    ).canonical;

    const existingCurrentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (existingCurrentUser) {
      throw new ConflictException(
        'A current account already uses this email.',
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
            email: normalizedEmail,
            mobileNumber,
            passwordHash,
            role: dto.role,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
          },
        });

        const emailVerification =
          await this.emailVerificationService.createInitialVerification(
            transaction,
            user.id,
            normalizedEmail,
          );

        return {
          userId: user.id,
          role: user.role,
          emailVerificationRequired: true,
          emailVerificationExpiresAt: emailVerification.expiresAt,
        };
      });
    } catch (error: unknown) {
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
}
