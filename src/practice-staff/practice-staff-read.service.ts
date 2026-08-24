import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeStaffReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOwnedLocation(authenticatedUserId: string, practiceLocationId: string) {
    const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId: authenticatedUserId }, select: { id: true } });
    if (!doctor) throw new ForbiddenException('Only a Doctor may view clinic staffing.');
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfileId: doctor.id },
      select: { id: true, name: true, lifecycleStatus: true, currentRegularPracticeStaffId: true },
    });
    if (!location) throw new NotFoundException('Practice location was not found.');
    return location;
  }

  async getClinicStaffing(authenticatedUserId: string, practiceLocationId: string) {
    const location = await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    if (!location.currentRegularPracticeStaffId) return { location, regularSecretary: null };
    const assignment = await this.prisma.practiceStaff.findUnique({
      where: { id: location.currentRegularPracticeStaffId },
      select: {
        id: true,
        isActive: true,
        createdAt: true,
        user: {
          select: {
            id: true, firstName: true, middleName: true, lastName: true, email: true, mobileNumber: true,
            emailVerifiedAt: true, accountStatus: true, administrativeRestrictionStatus: true,
          },
        },
      },
    });
    return { location, regularSecretary: assignment };
  }

  async resolveExistingSecretary(authenticatedUserId: string, practiceLocationId: string, email: string) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' }, role: UserRole.SECRETARY },
      select: {
        id: true, firstName: true, middleName: true, lastName: true, email: true, mobileNumber: true,
        emailVerifiedAt: true, accountStatus: true, administrativeRestrictionStatus: true,
      },
    });
    if (!user) throw new NotFoundException('No eligible existing Secretary account was found for that email.');
    const eligible = user.accountStatus === UserAccountStatus.ACTIVE &&
      user.administrativeRestrictionStatus === AdministrativeRestrictionStatus.NONE && Boolean(user.emailVerifiedAt);
    return { user, eligible };
  }
}
