import { ForbiddenException, Injectable } from '@nestjs/common';

import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecretaryWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssignedClinics(authenticatedUserId: string) {
    await this.assertEligibleSecretary(authenticatedUserId);

    const clinics = await this.prisma.practiceLocation.findMany({
      where: {
        lifecycleStatus: { not: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED },
        currentRegularPracticeStaff: {
          is: {
            userId: authenticatedUserId,
            isActive: true,
            staffRole: PracticeStaffRole.SECRETARY,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        countryCode: true,
        timeZone: true,
        isBookingEnabled: true,
        secretarySettingsDrafts: {
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            authorPracticeStaffId: true,
            submittedAt: true,
            reviewedAt: true,
            reviewComment: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return clinics.map((clinic) => ({
      ...clinic,
      latestSettingsDraft: clinic.secretarySettingsDrafts[0] ?? null,
      settingsDrafts: clinic.secretarySettingsDrafts,
      secretarySettingsDrafts: undefined,
    }));
  }

  private async assertEligibleSecretary(authenticatedUserId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
      },
    });

    if (
      !actor ||
      actor.role !== UserRole.SECRETARY ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('Secretary workspace access is unavailable.');
    }
  }
}
