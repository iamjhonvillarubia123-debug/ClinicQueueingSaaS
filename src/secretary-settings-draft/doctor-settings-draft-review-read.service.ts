import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DoctorSettingsDraftReviewReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listSubmitted(authenticatedUserId: string) {
    await this.assertEligibleDoctor(authenticatedUserId);

    return this.prisma.secretarySettingsDraft.findMany({
      where: {
        status: SecretarySettingsDraftStatus.SUBMITTED,
        practiceLocation: { doctorProfile: { userId: authenticatedUserId } },
      },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
        practiceLocation: {
          select: { id: true, name: true, lifecycleStatus: true },
        },
        authorPracticeStaff: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  async getSubmitted(authenticatedUserId: string, draftId: string) {
    await this.assertEligibleDoctor(authenticatedUserId);

    const draft = await this.prisma.secretarySettingsDraft.findFirst({
      where: {
        id: draftId,
        practiceLocation: { doctorProfile: { userId: authenticatedUserId } },
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        reviewComment: true,
        createdAt: true,
        updatedAt: true,
        authorPracticeStaff: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
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
            scheduleExceptions: {
              orderBy: { serviceDate: 'asc' },
              select: {
                serviceDate: true,
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
    return draft;
  }

  private async assertEligibleDoctor(authenticatedUserId: string) {
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
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('Doctor settings review is unavailable.');
    }
  }
}
