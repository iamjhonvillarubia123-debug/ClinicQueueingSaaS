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
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertSecretarySettingsDraftPracticeScheduleDto } from './dto/upsert-secretary-settings-draft-practice-schedule.dto';

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
export class SecretarySettingsDraftScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertPracticeSchedule(
    authenticatedUserId: string,
    draftId: string,
    dto: UpsertSecretarySettingsDraftPracticeScheduleDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);

      const row = this.normalizeSchedule(dto);
      const saved =
        await transaction.secretarySettingsDraftPracticeSchedule.upsert({
          where: {
            secretarySettingsDraftId_weekday: {
              secretarySettingsDraftId: draft.id,
              weekday: dto.weekday,
            },
          },
          create: {
            secretarySettingsDraftId: draft.id,
            weekday: dto.weekday,
            ...row,
          },
          update: row,
        });

      return {
        saved: true,
        draftId: draft.id,
        weekday: saved.weekday,
      };
    });
  }

  private normalizeSchedule(
    dto: UpsertSecretarySettingsDraftPracticeScheduleDto,
  ) {
    if (!dto.isOpen) {
      if (
        dto.opensAtLocal ||
        dto.closesAtLocal ||
        dto.maximumOnlineBookingUntilLocal ||
        dto.maximumOperatingUntilLocal
      ) {
        throw new BadRequestException(
          'Closed recurring clinic schedules must not contain schedule times.',
        );
      }
      return {
        proposedIsOpen: false,
        proposedOpensAtLocal: null,
        proposedClosesAtLocal: null,
        proposedMaximumOnlineBookingUntilLocal: null,
        proposedMaximumOperatingUntilLocal: null,
      };
    }

    if (!dto.opensAtLocal || !dto.closesAtLocal) {
      throw new BadRequestException(
        'Open recurring clinic schedules require opening and closing times.',
      );
    }

    const opensAt = this.parseLocalTime(dto.opensAtLocal);
    const closesAt = this.parseLocalTime(dto.closesAtLocal);
    if (closesAt.getTime() <= opensAt.getTime()) {
      throw new BadRequestException(
        'Recurring clinic schedule must close after opening on the same day.',
      );
    }

    const onlineCutoff = dto.maximumOnlineBookingUntilLocal
      ? this.parseLocalTime(dto.maximumOnlineBookingUntilLocal)
      : null;
    if (
      onlineCutoff &&
      (onlineCutoff.getTime() < opensAt.getTime() ||
        onlineCutoff.getTime() > closesAt.getTime())
    ) {
      throw new BadRequestException(
        'Public booking cutoff must fall within the clinic schedule interval.',
      );
    }

    return {
      proposedIsOpen: true,
      proposedOpensAtLocal: opensAt,
      proposedClosesAtLocal: closesAt,
      proposedMaximumOnlineBookingUntilLocal: onlineCutoff,
      proposedMaximumOperatingUntilLocal: dto.maximumOperatingUntilLocal
        ? this.parseLocalTime(dto.maximumOperatingUntilLocal)
        : null,
    };
  }

  private parseLocalTime(value: string): Date {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      throw new BadRequestException('Local schedule time must use HH:mm.');
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      throw new BadRequestException('Local schedule time is invalid.');
    }
    return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
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
