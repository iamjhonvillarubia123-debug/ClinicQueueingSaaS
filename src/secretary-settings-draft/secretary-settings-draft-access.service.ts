import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SecretaryConfigurationArea =
  | 'CLINIC_DETAILS'
  | 'SERVICES'
  | 'BOOKING_QUESTIONS'
  | 'SCHEDULES';

@Injectable()
export class SecretarySettingsDraftAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMayCreateDraft(authenticatedUserId: string, practiceLocationId: string) {
    const assignment = await this.currentAssignment(authenticatedUserId, practiceLocationId);
    this.assertAnyConfigurationAccess(assignment);
  }

  async assertMaySubmitDraft(authenticatedUserId: string, draftId: string) {
    const draft = await this.requireDraft(draftId);
    const assignment = await this.currentAssignment(authenticatedUserId, draft.practiceLocationId);
    this.assertAnyConfigurationAccess(assignment);
  }

  async assertMayEditDraft(
    authenticatedUserId: string,
    draftId: string,
    area: SecretaryConfigurationArea,
  ) {
    const draft = await this.requireDraft(draftId);
    const assignment = await this.currentAssignment(authenticatedUserId, draft.practiceLocationId);
    const allowed =
      area === 'CLINIC_DETAILS' ? assignment.canManageClinicDetails :
      area === 'SERVICES' ? assignment.canManageServices :
      area === 'BOOKING_QUESTIONS' ? assignment.canManageBookingQuestions :
      assignment.canManageSchedules;
    if (!allowed) {
      throw new ForbiddenException('This Secretary was not granted access to propose changes in this configuration area.');
    }
  }

  private async requireDraft(draftId: string) {
    const draft = await this.prisma.secretarySettingsDraft.findUnique({
      where: { id: draftId },
      select: { practiceLocationId: true },
    });
    if (!draft) throw new NotFoundException('Settings draft was not found.');
    return draft;
  }

  private async currentAssignment(authenticatedUserId: string, practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
        currentRegularPracticeStaff: {
          userId: authenticatedUserId,
          isActive: true,
        },
      },
      select: {
        currentRegularPracticeStaff: {
          select: {
            canManageClinicDetails: true,
            canManageServices: true,
            canManageBookingQuestions: true,
            canManageSchedules: true,
          },
        },
      },
    });
    const assignment = location?.currentRegularPracticeStaff;
    if (!assignment) {
      throw new ForbiddenException('Only the current regular Secretary may prepare clinic configuration changes.');
    }
    return assignment;
  }

  private assertAnyConfigurationAccess(assignment: {
    canManageClinicDetails: boolean;
    canManageServices: boolean;
    canManageBookingQuestions: boolean;
    canManageSchedules: boolean;
  }) {
    if (
      !assignment.canManageClinicDetails &&
      !assignment.canManageServices &&
      !assignment.canManageBookingQuestions &&
      !assignment.canManageSchedules
    ) {
      throw new ForbiddenException('This Secretary has Standard access only and cannot prepare clinic configuration changes.');
    }
  }
}
