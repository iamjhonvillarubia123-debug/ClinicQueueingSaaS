import { ConflictException, Injectable } from '@nestjs/common';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AccountMobileVerificationService } from './account-mobile-verification.service';
import { RegisterAccountDto } from './dto/register-account.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordSecurityService } from './security/password-security.service';
import { parseAccountIdentifier } from './security/account-identifier';

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
          ? { email: identifier.normalized }
          : { mobileNumberHash: identifier.mobileHash }),
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (existingCurrentUser) {
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
            userId: user.id,
            role: user.role,
            verificationChannel: 'EMAIL' as const,
            verificationRequired: true,
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
          userId: user.id,
          role: user.role,
          verificationChannel: 'MOBILE' as const,
          verificationRequired: true,
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
