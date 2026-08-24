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
import { SaveSecretarySettingsDraftClinicDetailsDto } from './dto/save-secretary-settings-draft-clinic-details.dto';

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
export class SecretarySettingsDraftClinicDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    authenticatedUserId: string,
    draftId: string,
    dto: SaveSecretarySettingsDraftClinicDetailsDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockEditableDraft(transaction, draftId);
      this.assertEditableByCurrentRegularSecretary(draft, authenticatedUserId);
      const proposal = this.normalize(dto);

      const saved = await transaction.secretarySettingsDraftClinicDetails.upsert({
        where: { secretarySettingsDraftId: draft.id },
        update: proposal,
        create: {
          secretarySettingsDraftId: draft.id,
          ...proposal,
        },
      });

      return { saved: true, draftId: draft.id, proposalId: saved.id };
    });
  }

  private normalize(dto: SaveSecretarySettingsDraftClinicDetailsDto) {
    const required = (value: string, label: string, maximum: number) => {
      const normalized = value.trim();
      if (!normalized) throw new BadRequestException(`${label} is required.`);
      if (normalized.length > maximum) {
        throw new BadRequestException(`${label} must not exceed ${maximum} characters.`);
      }
      return normalized;
    };
    const optional = (value: string | undefined, maximum: number) => {
      const normalized = value?.trim() ?? '';
      if (!normalized) return null;
      if (normalized.length > maximum) {
        throw new BadRequestException(`Optional clinic detail must not exceed ${maximum} characters.`);
      }
      return normalized;
    };

    const countryCode = required(dto.countryCode, 'Country code', 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      throw new BadRequestException('Country code must contain exactly two letters.');
    }

    const timeZone = required(dto.timeZone, 'Time zone', 100);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new BadRequestException('Time zone is invalid.');
    }

    return {
      proposedName: required(dto.name, 'Clinic name', 200),
      proposedAddressLine1: required(dto.addressLine1, 'Address line 1', 255),
      proposedAddressLine2: optional(dto.addressLine2, 255),
      proposedCityMunicipality: required(dto.cityMunicipality, 'City / municipality', 120),
      proposedProvince: required(dto.province, 'Province', 120),
      proposedPostalCode: optional(dto.postalCode, 20),
      proposedContactNumber: required(dto.contactNumber, 'Contact number', 30),
      proposedCountryCode: countryCode,
      proposedTimeZone: timeZone,
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
      INNER JOIN "PracticeLocation" pl ON pl."id" = d."practiceLocationId"
      LEFT JOIN "PracticeStaff" ps ON ps."id" = pl."currentRegularPracticeStaffId"
      WHERE d."id" = ${draftId}
      LIMIT 1
      FOR UPDATE OF d, pl
    `);
    const draft = rows[0];
    if (!draft) throw new NotFoundException('Settings draft was not found.');
    return draft;
  }

  private assertEditableByCurrentRegularSecretary(
    draft: LockedEditableDraft,
    authenticatedUserId: string,
  ) {
    const editable =
      draft.status === SecretarySettingsDraftStatus.DRAFT ||
      draft.status === SecretarySettingsDraftStatus.RETURNED_FOR_REWORK;
    if (!editable) {
      throw new ConflictException('Only a draft returned to editable state may be changed.');
    }
    if (
      draft.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED ||
      !draft.currentRegularPracticeStaffId ||
      !draft.currentAssignmentActive ||
      draft.currentSecretaryUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException('Only the current regular secretary may change this settings draft.');
    }
  }
}
