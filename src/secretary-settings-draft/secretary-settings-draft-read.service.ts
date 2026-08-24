import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecretarySettingsDraftReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getDraft(authenticatedUserId: string, draftId: string) {
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
      throw new ForbiddenException('Secretary settings access is unavailable.');
    }

    const draft = await this.prisma.secretarySettingsDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        reviewComment: true,
        createdAt: true,
        updatedAt: true,
        practiceLocation: {
          select: {
            id: true,
            name: true,
            addressLine1: true,
            addressLine2: true,
            cityMunicipality: true,
            province: true,
            postalCode: true,
            contactNumber: true,
            countryCode: true,
            lifecycleStatus: true,
            timeZone: true,
            currentRegularPracticeStaff: {
              select: {
                userId: true,
                isActive: true,
                staffRole: true,
                accessProfile: true,
                canManageClinicDetails: true,
                canManageServices: true,
                canManageBookingQuestions: true,
                canManageSchedules: true,
              },
            },
            practiceSchedules: {
              orderBy: { weekday: 'asc' },
              select: {
                weekday: true,
                isOpen: true,
                opensAtLocal: true,
                closesAtLocal: true,
                maximumOnlineBookingUntilLocal: true,
                maximumOperatingUntilLocal: true,
              },
            },
            services: {
              orderBy: [{ status: 'asc' }, { name: 'asc' }],
              select: {
                id: true,
                name: true,
                durationMinutes: true,
                status: true,
              },
            },
            bookingQuestions: {
              orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                questionText: true,
                helpText: true,
                type: true,
                isRequired: true,
                displayOrder: true,
                isActive: true,
                textMaximumLength: true,
                numberMinimum: true,
                numberMaximum: true,
                selectOptions: true,
              },
            },
          },
        },
        proposedClinicDetails: true,
        proposedPracticeSchedules: { orderBy: { weekday: 'asc' } },
        proposedServices: { orderBy: { id: 'asc' } },
        proposedBookingQuestions: { orderBy: { id: 'asc' } },
        proposedScheduleExceptions: { orderBy: { serviceDate: 'asc' } },
      },
    });

    if (!draft) throw new NotFoundException('Settings draft was not found.');

    const assignment = draft.practiceLocation.currentRegularPracticeStaff;
    if (
      !assignment ||
      !assignment.isActive ||
      assignment.staffRole !== PracticeStaffRole.SECRETARY ||
      assignment.userId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the current regular secretary may view this settings draft.',
      );
    }

    return draft;
  }
}
