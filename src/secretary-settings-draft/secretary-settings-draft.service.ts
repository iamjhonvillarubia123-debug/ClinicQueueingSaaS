import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AdministrativeRestrictionStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSecretarySettingsDraftDto } from './dto/create-secretary-settings-draft.dto';
import { ReviewSecretarySettingsDraftDto } from './dto/review-secretary-settings-draft.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type DraftAuthority = {
  practiceLocationId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  currentRegularPracticeStaffId: string | null;
  currentSecretaryUserId: string | null;
  currentAssignmentActive: boolean | null;
};

type LockedDraft = {
  id: string;
  practiceLocationId: string;
  authorPracticeStaffId: string;
  status: SecretarySettingsDraftStatus;
};

type ReviewCommandType =
  | typeof CommandType.PRACTICE_LOCATION_REJECT_SETTINGS_DRAFT
  | typeof CommandType.PRACTICE_LOCATION_RETURN_SETTINGS_DRAFT;

type ReviewTargetStatus =
  | typeof SecretarySettingsDraftStatus.REJECTED
  | typeof SecretarySettingsDraftStatus.RETURNED_FOR_REWORK;

@Injectable()
export class SecretarySettingsDraftService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    authenticatedUserId: string,
    dto: CreateSecretarySettingsDraftDto,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const authority = await this.lockDraftAuthority(
        transaction,
        dto.practiceLocationId,
      );
      this.assertCurrentRegularSecretary(authority, authenticatedUserId);

      const existing = await transaction.secretarySettingsDraft.findFirst({
        where: {
          practiceLocationId: dto.practiceLocationId,
          status: {
            in: [
              SecretarySettingsDraftStatus.DRAFT,
              SecretarySettingsDraftStatus.RETURNED_FOR_REWORK,
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (existing) {
        return { ...existing, reused: true };
      }

      const created = await transaction.secretarySettingsDraft.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          authorPracticeStaffId: authority.currentRegularPracticeStaffId!,
          status: SecretarySettingsDraftStatus.DRAFT,
        },
      });

      return { ...created, reused: false };
    });
  }

  async submit(authenticatedUserId: string, draftId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const draft = await this.lockDraft(transaction, draftId);
      if (!draft) {
        throw new NotFoundException('Settings draft was not found.');
      }

      const authority = await this.lockDraftAuthority(
        transaction,
        draft.practiceLocationId,
      );
      this.assertCurrentRegularSecretary(authority, authenticatedUserId);

      if (
        draft.status !== SecretarySettingsDraftStatus.DRAFT &&
        draft.status !== SecretarySettingsDraftStatus.RETURNED_FOR_REWORK
      ) {
        throw new ConflictException(
          'Only an editable settings draft may be submitted.',
        );
      }

      const now = new Date();
      await transaction.secretarySettingsDraft.update({
        where: { id: draft.id },
        data: {
          status: SecretarySettingsDraftStatus.SUBMITTED,
          submittedAt: now,
          reviewedAt: null,
          reviewedByUserId: null,
          reviewComment: null,
        },
      });

      return {
        submitted: true,
        draftId: draft.id,
        status: SecretarySettingsDraftStatus.SUBMITTED,
      };
    });
  }

  reject(
    authenticatedUserId: string,
    draftId: string,
    dto: ReviewSecretarySettingsDraftDto,
    idempotencyKey: string,
  ) {
    return this.review(
      authenticatedUserId,
      draftId,
      dto,
      idempotencyKey,
      CommandType.PRACTICE_LOCATION_REJECT_SETTINGS_DRAFT,
      SecretarySettingsDraftStatus.REJECTED,
    );
  }

  returnForRework(
    authenticatedUserId: string,
    draftId: string,
    dto: ReviewSecretarySettingsDraftDto,
    idempotencyKey: string,
  ) {
    return this.review(
      authenticatedUserId,
      draftId,
      dto,
      idempotencyKey,
      CommandType.PRACTICE_LOCATION_RETURN_SETTINGS_DRAFT,
      SecretarySettingsDraftStatus.RETURNED_FOR_REWORK,
    );
  }

  private async review(
    authenticatedUserId: string,
    draftId: string,
    dto: ReviewSecretarySettingsDraftDto,
    idempotencyKey: string,
    commandType: ReviewCommandType,
    targetStatus: ReviewTargetStatus,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const comment = dto.reviewComment?.trim() || null;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${draftId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${draftId}|${comment ?? ''}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const draft = await this.lockDraft(transaction, draftId);
      if (!draft) {
        throw new NotFoundException('Settings draft was not found.');
      }

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return {
          reviewed: true,
          replayed: true,
          draftId: draft.id,
          status: targetStatus,
        };
      }

      await this.assertOwningDoctor(
        transaction,
        authenticatedUserId,
        draft.practiceLocationId,
      );

      if (draft.status !== SecretarySettingsDraftStatus.SUBMITTED) {
        throw new ConflictException(
          'Only a submitted settings draft may be reviewed.',
        );
      }

      const now = new Date();
      await transaction.secretarySettingsDraft.update({
        where: { id: draft.id },
        data: {
          status: targetStatus,
          reviewedAt: now,
          reviewedByUserId: authenticatedUserId,
          reviewComment: comment,
        },
      });

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: draft.practiceLocationId,
          actorUserId: authenticatedUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        reviewed: true,
        replayed: false,
        draftId: draft.id,
        status: targetStatus,
      };
    });
  }

  private async lockDraftAuthority(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<DraftAuthority> {
    const rows = await transaction.$queryRaw<DraftAuthority[]>(Prisma.sql`
      SELECT
        pl."id" AS "practiceLocationId",
        pl."lifecycleStatus",
        pl."currentRegularPracticeStaffId",
        ps."userId" AS "currentSecretaryUserId",
        ps."isActive" AS "currentAssignmentActive"
      FROM "PracticeLocation" pl
      LEFT JOIN "PracticeStaff" ps
        ON ps."id" = pl."currentRegularPracticeStaffId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const authority = rows[0];
    if (!authority) {
      throw new NotFoundException('Practice location was not found.');
    }
    return authority;
  }

  private async lockDraft(
    transaction: TransactionClient,
    draftId: string,
  ): Promise<LockedDraft | null> {
    const rows = await transaction.$queryRaw<LockedDraft[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "authorPracticeStaffId",
        "status"
      FROM "SecretarySettingsDraft"
      WHERE "id" = ${draftId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private assertCurrentRegularSecretary(
    authority: DraftAuthority,
    authenticatedUserId: string,
  ): void {
    if (
      authority.lifecycleStatus ===
        PracticeLocationLifecycleStatus.PERMANENTLY_DELETED ||
      !authority.currentRegularPracticeStaffId ||
      !authority.currentAssignmentActive ||
      authority.currentSecretaryUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the current regular secretary may manage this settings draft.',
      );
    }
  }

  private async assertOwningDoctor(
    transaction: TransactionClient,
    authenticatedUserId: string,
    practiceLocationId: string,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        doctorProfile: {
          select: {
            practiceLocations: {
              where: { id: practiceLocationId },
              select: { id: true },
            },
          },
        },
      },
    });

    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      actor.doctorProfile?.practiceLocations.length !== 1
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may review this settings draft.',
      );
    }
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  private assertCompatibleReplay(
    storedFingerprint: string,
    requestFingerprint: string,
  ): void {
    if (storedFingerprint !== requestFingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `;
  }
}
