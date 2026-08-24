import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeStaffReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getClinicStaffing(authenticatedUserId: string, practiceLocationId: string) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { userId: authenticatedUserId },
      select: { id: true },
    });
    if (!doctor) throw new ForbiddenException('Only a Doctor may view clinic staffing.');

    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfileId: doctor.id },
      select: {
        id: true,
        name: true,
        lifecycleStatus: true,
        currentRegularPracticeStaffId: true,
      },
    });
    if (!location) throw new NotFoundException('Practice location was not found.');

    if (!location.currentRegularPracticeStaffId) {
      return { location, regularSecretary: null };
    }

    const assignment = await this.prisma.practiceStaff.findUnique({
      where: { id: location.currentRegularPracticeStaffId },
      select: {
        id: true,
        isActive: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            email: true,
            mobileNumber: true,
            emailVerifiedAt: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
          },
        },
      },
    });

    return { location, regularSecretary: assignment };
  }
}
