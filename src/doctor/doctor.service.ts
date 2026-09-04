import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
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
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { UpdateDoctorAccountSettingsDto } from './dto/update-doctor-account-settings.dto';

const MAX_PATIENT_ESTIMATED_SERVICE_MINUTES = 3 * 24 * 60;

type DoctorDurationSettingsRow = {
  maximumEstimatedServiceMinutesPerPatient: number | null;
  defaultTimeZone: string;
  maximumAdvanceBookingDays: number;
  allowOnlineBooking: boolean;
};

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

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

    const passwordHash = await this.passwordSecurityService.hash(
      registerDoctorDto.password,
    );

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

  async getAccountSettings(authenticatedUserId: string) {
    const rows = await this.prisma.$queryRaw<DoctorDurationSettingsRow[]>(
      Prisma.sql`
        SELECT s."maximumEstimatedServiceMinutesPerPatient", s."defaultTimeZone",
          s."maximumAdvanceBookingDays", s."allowOnlineBooking"
        FROM "DoctorAccountSettings" s
        INNER JOIN "DoctorProfile" d ON d."id" = s."doctorProfileId"
        INNER JOIN "User" u ON u."id" = d."userId"
        WHERE d."userId" = ${authenticatedUserId}
          AND u."role" = 'DOCTOR' AND u."accountStatus" = 'ACTIVE'
          AND u."administrativeRestrictionStatus" = 'NONE'
        LIMIT 1
      `,
    );
    const settings = rows[0];
    if (!settings) {
      throw new ForbiddenException(
        'Only a Doctor may manage Doctor account settings.',
      );
    }
    return settings;
  }

  async updateAccountSettings(
    authenticatedUserId: string,
    dto: UpdateDoctorAccountSettingsDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException(
        'At least one account setting is required.',
      );
    }
    const maximumEstimatedServiceMinutesPerPatient =
      dto.maximumEstimatedServiceMinutesPerPatient;
    if (
      maximumEstimatedServiceMinutesPerPatient !== undefined &&
      maximumEstimatedServiceMinutesPerPatient !== null &&
      (!Number.isInteger(maximumEstimatedServiceMinutesPerPatient) ||
        maximumEstimatedServiceMinutesPerPatient < 1 ||
        maximumEstimatedServiceMinutesPerPatient >
          MAX_PATIENT_ESTIMATED_SERVICE_MINUTES)
    ) {
      throw new BadRequestException(
        'Maximum estimated service minutes per patient must be between 1 and 4320 minutes, or null for no cap.',
      );
    }

    const changes: Prisma.Sql[] = [];
    if (maximumEstimatedServiceMinutesPerPatient !== undefined) {
      changes.push(
        Prisma.sql`"maximumEstimatedServiceMinutesPerPatient" = ${maximumEstimatedServiceMinutesPerPatient}`,
      );
    }
    if (dto.defaultTimeZone !== undefined) {
      if (
        typeof dto.defaultTimeZone !== 'string' ||
        !dto.defaultTimeZone.trim()
      )
        throw new BadRequestException('A valid timezone is required.');
      this.assertValidTimeZone(dto.defaultTimeZone);
      changes.push(Prisma.sql`"defaultTimeZone" = ${dto.defaultTimeZone}`);
    }
    if (dto.maximumAdvanceBookingDays !== undefined) {
      if (
        !Number.isInteger(dto.maximumAdvanceBookingDays) ||
        dto.maximumAdvanceBookingDays < 0 ||
        dto.maximumAdvanceBookingDays > 365
      )
        throw new BadRequestException(
          'Advance booking must be between 0 and 365 days.',
        );
      changes.push(
        Prisma.sql`"maximumAdvanceBookingDays" = ${dto.maximumAdvanceBookingDays}`,
      );
    }
    if (dto.allowOnlineBooking !== undefined) {
      if (typeof dto.allowOnlineBooking !== 'boolean')
        throw new BadRequestException('Online booking must be true or false.');
      changes.push(
        Prisma.sql`"allowOnlineBooking" = ${dto.allowOnlineBooking}`,
      );
    }
    if (!changes.length)
      throw new BadRequestException('No supported settings supplied.');
    const rows = await this.prisma.$queryRaw<DoctorDurationSettingsRow[]>(
      Prisma.sql`
        WITH eligible AS (
          SELECT "id", "role", "accountStatus", "administrativeRestrictionStatus"
          FROM "User" WHERE "id" = ${authenticatedUserId} FOR UPDATE
        )
        UPDATE "DoctorAccountSettings" s
        SET
          ${Prisma.join(changes)},
          "updatedAt" = CURRENT_TIMESTAMP
        FROM "DoctorProfile" d, eligible u
        WHERE s."doctorProfileId" = d."id"
          AND d."userId" = ${authenticatedUserId}
          AND u."id" = d."userId" AND u."role" = 'DOCTOR'
          AND u."accountStatus" = 'ACTIVE' AND u."administrativeRestrictionStatus" = 'NONE'
        RETURNING s."maximumEstimatedServiceMinutesPerPatient", s."defaultTimeZone",
          s."maximumAdvanceBookingDays", s."allowOnlineBooking"
      `,
    );
    const settings = rows[0];
    if (!settings) {
      throw new ForbiddenException(
        'Only a Doctor may manage Doctor account settings.',
      );
    }
    return settings;
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
