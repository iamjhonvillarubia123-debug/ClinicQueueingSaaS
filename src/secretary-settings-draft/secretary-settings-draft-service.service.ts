import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
  SecretarySettingsDraftStatus,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveSecretarySettingsDraftServiceDto } from './dto/save-secretary-settings-draft-service.dto';

type TransactionClient = Prisma.TransactionClient;

type LockedEditableDraft = {
  id: string;
  practiceLocationId: string;
  status: SecretarySettingsDraftStatus;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  currentRegularPracticeStaffId: string | null;
  currentSecretaryUserId: string | null;
  currentAssignmentActive: boolean | null;
};

@Injectable()
export class SecretarySettingsDraftServiceProposalService {
  constructor(private readonly prisma: PrismaService) {}

  async createProposal(
    authenticatedUserId: string,
    draftId: string,
    dto: SaveSecretarySettingsDraftServiceDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const saved = await transaction.secretarySettingsDraftService.create({
        data: {
          secretarySettingsDraftId: draft.id,
          practiceLocationServiceId: null,
          sourceDoctorServiceTemplateId: null,
          ...proposed,
        },
      });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        practiceLocationServiceId: null,
        proposedStatus: saved.proposedStatus,
      };
    });
  }

  async upsertExistingServiceProposal(
    authenticatedUserId: string,
    draftId: string,
    practiceLocationServiceId: string,
    dto: SaveSecretarySettingsDraftServiceDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const effectiveService = await transaction.practiceLocationService.findFirst({
        where: {
          id: practiceLocationServiceId,
          practiceLocationId: draft.practiceLocationId,
        },
        select: {
          id: true,
          sourceDoctorServiceTemplateId: true,
        },
      });
      if (!effectiveService) {
        throw new NotFoundException(
          'Practice location service was not found for this draft location.',
        );
      }

      const existingProposal =
        await transaction.secretarySettingsDraftService.findFirst({
          where: {
            secretarySettingsDraftId: draft.id,
            practiceLocationServiceId: effectiveService.id,
          },
          select: { id: true },
        });

      const saved = existingProposal
        ? await transaction.secretarySettingsDraftService.update({
            where: { id: existingProposal.id },
            data: proposed,
          })
        : await transaction.secretarySettingsDraftService.create({
            data: {
              secretarySettingsDraftId: draft.id,
              practiceLocationServiceId: effectiveService.id,
              sourceDoctorServiceTemplateId:
                effectiveService.sourceDoctorServiceTemplateId,
              ...proposed,
            },
          });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        practiceLocationServiceId: effectiveService.id,
        proposedStatus: saved.proposedStatus,
      };
    });
  }

  async updateProposal(
    authenticatedUserId: string,
    draftId: string,
    proposalId: string,
    dto: SaveSecretarySettingsDraftServiceDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const proposal = await transaction.secretarySettingsDraftService.findFirst({
        where: {
          id: proposalId,
          secretarySettingsDraftId: draft.id,
        },
        select: {
          id: true,
          practiceLocationServiceId: true,
        },
      });
      if (!proposal) {
        throw new NotFoundException('Service proposal was not found.');
      }

      const saved = await transaction.secretarySettingsDraftService.update({
        where: { id: proposal.id },
        data: proposed,
      });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        practiceLocationServiceId: proposal.practiceLocationServiceId,
        proposedStatus: saved.proposedStatus,
      };
    });
  }

  private normalizeProposal(dto: SaveSecretarySettingsDraftServiceDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Service name is required.');
    }
    if (name.length > 150) {
      throw new BadRequestException(
        'Service name must not exceed 150 characters.',
      );
    }
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes <= 0) {
      throw new BadRequestException(
        'Service duration must be a positive whole number of minutes.',
      );
    }
    if (
      dto.status !== ServiceAvailabilityStatus.ACTIVE &&
      dto.status !== ServiceAvailabilityStatus.INACTIVE
    ) {
      throw new BadRequestException('Service availability status is invalid.');
    }

    return {
      proposedName: name,
      proposedDurationMinutes: dto.durationMinutes,
      proposedStatus: dto.status,
    };
  }

  private async lockEditableDraft(
    transaction: TransactionClient,
    draftId: string,
  ): Promise<LockedEditableDraft> {
    const rows = await transaction.$queryRaw<LockedEditableDraft[]>(Prisma.sql`
      SELECT
        d."id",
        d."practiceLocationId",
        d."status",
        pl."lifecycleStatus",
        pl."currentRegularPracticeStaffId",
        ps."userId" AS "currentSecretaryUserId",
        ps."isActive" AS "currentAssignmentActive"
      FROM "SecretarySettingsDraft" d
      INNER JOIN "PracticeLocation" pl
        ON pl."id" = d."practiceLocationId"
      LEFT JOIN "PracticeStaff" ps
        ON ps."id" = pl."currentRegularPracticeStaffId"
      WHERE d."id" = ${draftId}
      LIMIT 1
      FOR UPDATE OF d, pl
    `);
    const draft = rows[0];
    if (!draft) {
      throw new NotFoundException('Settings draft was not found.');
    }
    return draft;
  }

  private assertEditableByCurrentRegularSecretary(
    draft: LockedEditableDraft,
    authenticatedUserId: string,
  ): void {
    const editable =
      draft.status === SecretarySettingsDraftStatus.DRAFT ||
      draft.status === SecretarySettingsDraftStatus.RETURNED_FOR_REWORK;
    if (!editable) {
      throw new ConflictException(
        'Only a draft returned to editable state may be changed.',
      );
    }

    if (
      draft.lifecycleStatus ===
        PracticeLocationLifecycleStatus.PERMANENTLY_DELETED ||
      !draft.currentRegularPracticeStaffId ||
      !draft.currentAssignmentActive ||
      draft.currentSecretaryUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the current regular secretary may change this settings draft.',
      );
    }
  }
}
