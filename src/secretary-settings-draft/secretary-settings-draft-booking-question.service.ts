import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  Prisma,
  SecretarySettingsDraftStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveSecretarySettingsDraftBookingQuestionDto } from './dto/save-secretary-settings-draft-booking-question.dto';

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
export class SecretarySettingsDraftBookingQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async createProposal(
    authenticatedUserId: string,
    draftId: string,
    dto: SaveSecretarySettingsDraftBookingQuestionDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const saved =
        await transaction.secretarySettingsDraftBookingQuestion.create({
          data: {
            secretarySettingsDraftId: draft.id,
            bookingQuestionId: null,
            sourceDoctorBookingQuestionTemplateId: null,
            ...proposed,
          },
        });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        bookingQuestionId: null,
        proposedIsActive: saved.proposedIsActive,
      };
    });
  }

  async upsertExistingQuestionProposal(
    authenticatedUserId: string,
    draftId: string,
    bookingQuestionId: string,
    dto: SaveSecretarySettingsDraftBookingQuestionDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const effectiveQuestion = await transaction.bookingQuestion.findFirst({
        where: {
          id: bookingQuestionId,
          practiceLocationId: draft.practiceLocationId,
        },
        select: {
          id: true,
          questionText: true,
          type: true,
          selectOptions: true,
          _count: {
            select: {
              bookingDraftAnswers: true,
              appointmentAnswers: true,
            },
          },
        },
      });
      if (!effectiveQuestion) {
        throw new NotFoundException(
          'Booking question was not found for this draft location.',
        );
      }
      this.assertHistoricalMeaningUnchanged(effectiveQuestion, proposed);

      const existingProposal =
        await transaction.secretarySettingsDraftBookingQuestion.findFirst({
          where: {
            secretarySettingsDraftId: draft.id,
            bookingQuestionId: effectiveQuestion.id,
          },
          select: { id: true },
        });

      const saved = existingProposal
        ? await transaction.secretarySettingsDraftBookingQuestion.update({
            where: { id: existingProposal.id },
            data: proposed,
          })
        : await transaction.secretarySettingsDraftBookingQuestion.create({
            data: {
              secretarySettingsDraftId: draft.id,
              bookingQuestionId: effectiveQuestion.id,
              sourceDoctorBookingQuestionTemplateId: null,
              ...proposed,
            },
          });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        bookingQuestionId: effectiveQuestion.id,
        proposedIsActive: saved.proposedIsActive,
      };
    });
  }

  async updateProposal(
    authenticatedUserId: string,
    draftId: string,
    proposalId: string,
    dto: SaveSecretarySettingsDraftBookingQuestionDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposed = this.normalizeProposal(dto);

      const proposal =
        await transaction.secretarySettingsDraftBookingQuestion.findFirst({
          where: { id: proposalId, secretarySettingsDraftId: draft.id },
          select: { id: true, bookingQuestionId: true },
        });
      if (!proposal) {
        throw new NotFoundException('Booking question proposal was not found.');
      }

      if (proposal.bookingQuestionId) {
        const effectiveQuestion = await transaction.bookingQuestion.findFirst({
          where: {
            id: proposal.bookingQuestionId,
            practiceLocationId: draft.practiceLocationId,
          },
          select: {
            id: true,
            questionText: true,
            type: true,
            selectOptions: true,
            _count: {
              select: {
                bookingDraftAnswers: true,
                appointmentAnswers: true,
              },
            },
          },
        });
        if (!effectiveQuestion) {
          throw new NotFoundException(
            'Booking question was not found for this draft location.',
          );
        }
        this.assertHistoricalMeaningUnchanged(effectiveQuestion, proposed);
      }

      const saved =
        await transaction.secretarySettingsDraftBookingQuestion.update({
          where: { id: proposal.id },
          data: proposed,
        });

      return {
        saved: true,
        draftId: draft.id,
        proposalId: saved.id,
        bookingQuestionId: proposal.bookingQuestionId,
        proposedIsActive: saved.proposedIsActive,
      };
    });
  }

  private assertHistoricalMeaningUnchanged(
    effectiveQuestion: {
      questionText: string;
      type: BookingQuestionType;
      selectOptions: Prisma.JsonValue | null;
      _count: { bookingDraftAnswers: number; appointmentAnswers: number };
    },
    proposed: {
      proposedQuestionText: string;
      proposedType: BookingQuestionType;
      proposedSelectOptions: Prisma.JsonValue;
    },
  ): void {
    const hasHistory =
      effectiveQuestion._count.bookingDraftAnswers > 0 ||
      effectiveQuestion._count.appointmentAnswers > 0;
    if (!hasHistory) {
      return;
    }

    const currentOptions = effectiveQuestion.selectOptions ?? null;
    const proposedOptions =
      proposed.proposedSelectOptions === Prisma.JsonNull
        ? null
        : proposed.proposedSelectOptions;
    const protectedMeaningChanged =
      effectiveQuestion.questionText !== proposed.proposedQuestionText ||
      effectiveQuestion.type !== proposed.proposedType ||
      JSON.stringify(currentOptions) !== JSON.stringify(proposedOptions);

    if (protectedMeaningChanged) {
      throw new ConflictException(
        'Answered BookingQuestion meaning cannot be changed. Deactivate the existing question and create a replacement instead.',
      );
    }
  }

  private normalizeProposal(dto: SaveSecretarySettingsDraftBookingQuestionDto) {
    const questionText = dto.questionText.trim();
    const helpText = dto.helpText?.trim() || null;
    if (!questionText) {
      throw new BadRequestException('Booking question text is required.');
    }
    if (questionText.length > 500 || (helpText?.length ?? 0) > 500) {
      throw new BadRequestException('Booking question text is too long.');
    }
    if (!Number.isInteger(dto.displayOrder) || dto.displayOrder < 0) {
      throw new BadRequestException('Display order must be zero or greater.');
    }
    if (!Number.isInteger(dto.estimatedMinutesAdjustment)) {
      throw new BadRequestException(
        'Estimated minutes adjustment must be a whole number.',
      );
    }

    const typeFields = this.normalizeTypeFields(dto);
    return {
      proposedQuestionText: questionText,
      proposedHelpText: helpText,
      proposedType: dto.type,
      proposedIsRequired: dto.isRequired,
      proposedDisplayOrder: dto.displayOrder,
      proposedIsActive: dto.isActive,
      proposedEstimatedMinutesAdjustment: dto.estimatedMinutesAdjustment,
      ...typeFields,
    };
  }

  private normalizeTypeFields(
    dto: SaveSecretarySettingsDraftBookingQuestionDto,
  ) {
    if (dto.type === BookingQuestionType.TEXT) {
      if (
        dto.numberMinimum !== undefined ||
        dto.numberMaximum !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'TEXT questions may only use textMaximumLength.',
        );
      }
      return {
        proposedTextMaximumLength: dto.textMaximumLength ?? null,
        proposedNumberMinimum: null,
        proposedNumberMaximum: null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type === BookingQuestionType.NUMBER) {
      if (
        dto.textMaximumLength !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'NUMBER questions may only use numeric limits.',
        );
      }
      if (
        dto.numberMinimum !== undefined &&
        dto.numberMaximum !== undefined &&
        dto.numberMinimum > dto.numberMaximum
      ) {
        throw new BadRequestException(
          'Number minimum must not exceed number maximum.',
        );
      }
      return {
        proposedTextMaximumLength: null,
        proposedNumberMinimum: dto.numberMinimum ?? null,
        proposedNumberMaximum: dto.numberMaximum ?? null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type === BookingQuestionType.BOOLEAN) {
      if (
        dto.textMaximumLength !== undefined ||
        dto.numberMinimum !== undefined ||
        dto.numberMaximum !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'BOOLEAN questions do not accept validation fields.',
        );
      }
      return {
        proposedTextMaximumLength: null,
        proposedNumberMinimum: null,
        proposedNumberMaximum: null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type !== BookingQuestionType.SINGLE_SELECT) {
      throw new BadRequestException('Booking question type is invalid.');
    }
    if (
      dto.textMaximumLength !== undefined ||
      dto.numberMinimum !== undefined ||
      dto.numberMaximum !== undefined
    ) {
      throw new BadRequestException(
        'SINGLE_SELECT questions may only use selectOptions.',
      );
    }
    const options = dto.selectOptions;
    if (!options || options.length < 2) {
      throw new BadRequestException(
        'SINGLE_SELECT questions require at least two options.',
      );
    }
    const normalized = options.map((option) => ({
      value: option.value.trim(),
      label: option.label.trim(),
    }));
    const values = new Set<string>();
    for (const option of normalized) {
      if (!option.value || !option.label) {
        throw new BadRequestException(
          'Select option values and labels are required.',
        );
      }
      if (option.value.length > 100 || option.label.length > 200) {
        throw new BadRequestException(
          'Select option value or label is too long.',
        );
      }
      if (values.has(option.value)) {
        throw new BadRequestException('Select option values must be unique.');
      }
      values.add(option.value);
    }
    return {
      proposedTextMaximumLength: null,
      proposedNumberMinimum: null,
      proposedNumberMaximum: null,
      proposedSelectOptions: normalized,
    };
  }

  private async lockEditableDraft(
    transaction: TransactionClient,
    draftId: string,
  ): Promise<LockedEditableDraft> {
    const rows = await transaction.$queryRaw<LockedEditableDraft[]>(Prisma.sql`
      SELECT
        d."id", d."practiceLocationId", d."status", pl."lifecycleStatus",
        pl."currentRegularPracticeStaffId",
        ps."userId" AS "currentSecretaryUserId",
        ps."isActive" AS "currentAssignmentActive"
      FROM "SecretarySettingsDraft" d
      INNER JOIN "PracticeLocation" pl ON pl."id" = d."practiceLocationId"
      LEFT JOIN "PracticeStaff" ps ON ps."id" = pl."currentRegularPracticeStaffId"
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
