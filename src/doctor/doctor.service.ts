import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { EmailVerificationService } from '../auth/email-verification.service';
import { normalizeEmail } from '../auth/security/session-security';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { RegisterDoctorDto } from './dto/register-doctor.dto';

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  async registerDoctor(registerDoctorDto: RegisterDoctorDto) {
    const normalizedEmail = normalizeEmail(registerDoctorDto.email);
    const firstName = registerDoctorDto.firstName.trim();
    const middleName = this.optionalTrim(registerDoctorDto.middleName);
    const lastName = registerDoctorDto.lastName.trim();
    const mobileNumber = this.mobileNumberService.normalize(
      registerDoctorDto.mobileNumber,
    ).canonical;
    const professionalTitle = registerDoctorDto.professionalTitle.trim();
    const specialization = registerDoctorDto.specialization.trim();
    const licenseNumber = registerDoctorDto.licenseNumber.trim();
    const suffix = this.optionalTrim(registerDoctorDto.suffix);
    const defaultTimeZone =
      registerDoctorDto.defaultTimeZone?.trim() || 'Asia/Manila';

    this.assertValidTimeZone(defaultTimeZone);

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

    const passwordHash = await this.hashPassword(registerDoctorDto.password);

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
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
          },
        });

        const doctorProfile = await transaction.doctorProfile.create({
          data: {
            userId: user.id,
            middleName,
            suffix,
            professionalTitle,
            specialization,
            licenseNumber,
            isProfilePublic: false,
          },
        });

        await transaction.doctorAccountSettings.create({
          data: {
            doctorProfileId: doctorProfile.id,
            defaultTimeZone,
            defaultConsultationMinutes:
              registerDoctorDto.defaultConsultationMinutes ?? 30,
            maximumAdvanceBookingDays:
              registerDoctorDto.maximumAdvanceBookingDays ?? 30,
            allowOnlineBooking: registerDoctorDto.allowOnlineBooking ?? true,
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
          doctorProfileId: doctorProfile.id,
          emailVerificationRequired: true,
          emailVerificationExpiresAt: emailVerification.expiresAt,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A current account or doctor license already exists.',
        );
      }

      throw error;
    }
  }

  private assertValidTimeZone(value: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    } catch {
      throw new BadRequestException(
        'defaultTimeZone must be a valid IANA time zone.',
      );
    }
  }

  private optionalTrim(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }
}
