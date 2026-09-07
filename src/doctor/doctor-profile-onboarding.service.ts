import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { accountIdentifierIsVerified } from '../auth/security/account-identifier';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteDoctorOnboardingDto } from './dto/complete-doctor-onboarding.dto';

@Injectable()
export class DoctorProfileOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfileState(authenticatedUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
        firstName: true,
        middleName: true,
        lastName: true,
        doctorProfile: {
          select: {
            id: true,
            middleName: true,
            suffix: true,
            professionalTitle: true,
            specialization: true,
            licenseNumber: true,
            profileDescription: true,
            profilePhotoUrl: true,
            publicIdentifier: true,
            publicSlug: true,
            isProfilePublic: true,
          },
        },
      },
    });

    this.assertEligibleDoctor(user);

    return {
      onboardingComplete: Boolean(user!.doctorProfile),
      user: {
        firstName: user!.firstName,
        middleName: user!.middleName,
        lastName: user!.lastName,
      },
      profile: user!.doctorProfile,
    };
  }

  async completeOnboarding(
    authenticatedUserId: string,
    dto: CompleteDoctorOnboardingDto,
  ) {
    const firstName = dto.firstName.trim();
    const middleName = this.optionalTrim(dto.middleName);
    const lastName = dto.lastName.trim();
    const suffix = this.optionalTrim(dto.suffix);
    const professionalTitle = dto.professionalTitle.trim();
    const specialization = dto.specialization.trim();
    const licenseNumber = dto.licenseNumber.trim();
    const profileDescription = this.optionalTrim(dto.profileDescription);

    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        emailVerifiedAt: true,
        mobileVerifiedAt: true,
        doctorProfile: { select: { id: true } },
      },
    });

    this.assertEligibleDoctor(user);

    if (user!.doctorProfile) {
      throw new ConflictException('Doctor onboarding is already complete.');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const lockedUsers = await transaction.$queryRaw<
          Array<{
            id: string;
            role: UserRole;
            accountStatus: UserAccountStatus;
            administrativeRestrictionStatus: AdministrativeRestrictionStatus;
            loginIdentifierType: AccountLoginIdentifierType;
            emailVerifiedAt: Date | null;
            mobileVerifiedAt: Date | null;
          }>
        >(Prisma.sql`
          SELECT "id", "role", "accountStatus", "administrativeRestrictionStatus",
                 "loginIdentifierType", "emailVerifiedAt", "mobileVerifiedAt"
          FROM "User"
          WHERE "id" = ${authenticatedUserId}
          FOR UPDATE
        `);
        const lockedUser = lockedUsers[0];
        this.assertEligibleDoctor(lockedUser);

        const existingProfile = await transaction.doctorProfile.findUnique({
          where: { userId: authenticatedUserId },
          select: { id: true },
        });
        if (existingProfile) {
          throw new ConflictException('Doctor onboarding is already complete.');
        }

        await transaction.user.update({
          where: { id: authenticatedUserId },
          data: { firstName, middleName, lastName },
        });

        const doctorProfile = await transaction.doctorProfile.create({
          data: {
            userId: authenticatedUserId,
            middleName,
            suffix,
            professionalTitle,
            specialization,
            licenseNumber,
            profileDescription,
            isProfilePublic: false,
          },
          select: {
            id: true,
            middleName: true,
            suffix: true,
            professionalTitle: true,
            specialization: true,
            licenseNumber: true,
            profileDescription: true,
            profilePhotoUrl: true,
            publicIdentifier: true,
            publicSlug: true,
            isProfilePublic: true,
          },
        });

        await transaction.doctorAccountSettings.create({
          data: { doctorProfileId: doctorProfile.id },
        });

        return {
          onboardingComplete: true,
          user: { firstName, middleName, lastName },
          profile: doctorProfile,
        };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const rawTarget = error.meta?.target;
        const target = Array.isArray(rawTarget)
          ? rawTarget
              .filter((value): value is string => typeof value === 'string')
              .join(',')
          : typeof rawTarget === 'string'
            ? rawTarget
            : '';
        if (target.includes('licenseNumber')) {
          throw new ConflictException(
            'This professional license number is already registered.',
          );
        }
        throw new ConflictException('Doctor onboarding is already complete.');
      }
      throw error;
    }
  }

  private assertEligibleDoctor(
    user: {
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
      loginIdentifierType: AccountLoginIdentifierType;
      emailVerifiedAt: Date | null;
      mobileVerifiedAt: Date | null;
    } | null,
  ): void {
    if (
      !user ||
      user.role !== UserRole.DOCTOR ||
      user.accountStatus !== UserAccountStatus.ACTIVE ||
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      !accountIdentifierIsVerified(user)
    ) {
      throw new ForbiddenException(
        'Only an active verified Doctor may complete Doctor onboarding.',
      );
    }
  }

  private optionalTrim(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }
}
