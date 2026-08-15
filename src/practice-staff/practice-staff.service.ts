import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';

@Injectable()
export class PracticeStaffService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(
    authenticatedUserId: string,
    assignPracticeStaffDto: AssignPracticeStaffDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: {
        userId: authenticatedUserId,
      },
    });

    if (!doctorProfile) {
      throw new ForbiddenException('Only a doctor may assign practice staff.');
    }

    const practiceLocation = await this.prisma.practiceLocation.findFirst({
      where: {
        id: assignPracticeStaffDto.practiceLocationId,
        doctorProfileId: doctorProfile.id,
      },
    });

    if (!practiceLocation) {
      throw new NotFoundException('Practice location was not found.');
    }

    const staffUser = await this.prisma.user.findUnique({
      where: {
        id: assignPracticeStaffDto.userId,
      },
    });

    if (!staffUser) {
      throw new NotFoundException('Secretary user was not found.');
    }

    if (
      staffUser.role !== UserRole.SECRETARY ||
      staffUser.accountStatus !== UserAccountStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        'Only an eligible active secretary user may be assigned as practice staff.',
      );
    }

    const existingAssignment = await this.prisma.practiceStaff.findFirst({
      where: {
        userId: staffUser.id,
        practiceLocationId: practiceLocation.id,
      },
    });

    if (existingAssignment) {
      throw new ConflictException(
        'This secretary is already assigned to this practice location.',
      );
    }

    return this.prisma.practiceStaff.create({
      data: {
        userId: staffUser.id,
        practiceLocationId: practiceLocation.id,
        staffRole: PracticeStaffRole.SECRETARY,
      },
      select: {
        id: true,
        userId: true,
        practiceLocationId: true,
        staffRole: true,
        isActive: true,
        createdAt: true,
      },
    });
  }
}
