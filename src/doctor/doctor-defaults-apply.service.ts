import { createHash, randomUUID } from 'crypto';
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
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplyDoctorDefaultsDto } from './dto/apply-doctor-defaults.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_BOOKING_QUESTIONS = 5;

type TransactionClient = Prisma.TransactionClient;

type ExistingQuestion = {
  id: string;
  practiceLocationId: string;
  sourceDoctorBookingQuestionTemplateId: string | null;
  displayOrder: number;
  isActive: boolean;
};

type ExistingTemplateQuestion = {
  id: string;
  questionText: string;
  type: string;
  selectOptions: Prisma.JsonValue | null;
  displayOrder: number;
  hasHistory: boolean;
};

@Injectable()
export class DoctorDefaultsApplyService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(
    authenticatedUserId: string,
    dto: ApplyDoctorDefaultsDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const targetIds = this.normalizeTargetIds(dto.practiceLocationIds);
    const commandType = CommandType.DOCTOR_DEFAULTS_APPLY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${targetIds.join(',')}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          doctorProfile: { select: { id: true } },
        },
      });
      this.assertEligibleDoctor(actor);
      const doctorProfileId = actor!.doctorProfile!.id;

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
        select: { id: true, requestFingerprint: true },
      });
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) {
          throw new ConflictException(
            'Idempotency key was already used for a different defaults Apply request.',
          );
        }
        const countRows = await transaction.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`
            SELECT COUNT(*)::bigint AS "count"
            FROM "DoctorDefaultsApplyAuditTarget" t
            INNER JOIN "DoctorDefaultsApplyAudit" a
              ON a."id" = t."doctorDefaultsApplyAuditId"
            WHERE a."commandIdempotencyId" = ${replay.id}
          `,
        );
        return {
          applied: true,
          replayed: true,
          practiceLocationCount: Number(countRows[0]?.count ?? 0n),
        };
      }

      await this.lockTargetLocations(transaction, targetIds);
      const locations = await transaction.practiceLocation.findMany({
        where: { id: { in: targetIds } },
        select: {
          id: true,
          doctorProfileId: true,
          lifecycleStatus: true,
        },
      });
      if (locations.length !== targetIds.length) {
        throw new NotFoundException(
          'One or more selected PracticeLocations were not found.',
        );
      }
      for (const location of locations) {
        if (location.doctorProfileId !== doctorProfileId) {
          throw new ForbiddenException(
            'Doctor-wide defaults may only be applied to PracticeLocations owned by the Doctor.',
          );
        }
        if (
          location.lifecycleStatus ===
          PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
        ) {
          throw new ConflictException(
            'Doctor-wide defaults cannot be applied to a permanently deleted PracticeLocation.',
          );
        }
      }

      const [serviceTemplates, questionTemplates] = await Promise.all([
        transaction.doctorServiceTemplate.findMany({
          where: { doctorProfileId },
          orderBy: { id: 'asc' },
        }),
        transaction.doctorBookingQuestionTemplate.findMany({
          where: { doctorProfileId },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);

      for (const practiceLocationId of targetIds) {
        await this.validateQuestionResult(
          transaction,
          practiceLocationId,
          questionTemplates,
        );
      }

      const now = new Date();
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          actorUserId: authenticatedUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
        select: { id: true },
      });

      const auditId = randomUUID();
      await transaction.$executeRaw(
        Prisma.sql`
          INSERT INTO "DoctorDefaultsApplyAudit"
            ("id", "doctorProfileId", "actorUserId", "commandIdempotencyId", "occurredAt")
          VALUES
            (${auditId}, ${doctorProfileId}, ${authenticatedUserId}, ${command.id}, ${now})
        `,
      );

      for (const practiceLocationId of targetIds) {
        const targetAuditId = randomUUID();
        await transaction.$executeRaw(
          Prisma.sql`
            INSERT INTO "DoctorDefaultsApplyAuditTarget"
              ("id", "doctorDefaultsApplyAuditId", "practiceLocationId")
            VALUES
              (${targetAuditId}, ${auditId}, ${practiceLocationId})
          `,
        );

        for (const template of serviceTemplates) {
          const existing = await transaction.practiceLocationService.findFirst({
            where: {
              practiceLocationId,
              sourceDoctorServiceTemplateId: template.id,
            },
            select: { id: true },
          });
          const target = existing
            ? await transaction.practiceLocationService.update({
                where: { id: existing.id },
                data: {
                  name: template.name,
                  durationMinutes: template.durationMinutes,
                  status: template.status,
                },
                select: { id: true },
              })
            : await transaction.practiceLocationService.create({
                data: {
                  practiceLocationId,
                  sourceDoctorServiceTemplateId: template.id,
                  name: template.name,
                  durationMinutes: template.durationMinutes,
                  status: template.status,
                },
                select: { id: true },
              });
          await this.insertAuditItem(
            transaction,
            targetAuditId,
            'SERVICE',
            template.id,
            target.id,
          );
        }

        for (const template of questionTemplates) {
          const targetId = await this.upsertBookingQuestion(
            transaction,
            practiceLocationId,
            template,
          );
          await this.insertAuditItem(
            transaction,
            targetAuditId,
            'BOOKING_QUESTION',
            template.id,
            targetId,
          );
        }
      }

      return {
        applied: true,
        replayed: false,
        practiceLocationCount: targetIds.length,
      };
    });
  }

  private async validateQuestionResult(
    transaction: TransactionClient,
    practiceLocationId: string,
    templates: Array<{ id: string; displayOrder: number; isActive: boolean }>,
  ) {
    const existing = await transaction.$queryRaw<ExistingQuestion[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "sourceDoctorBookingQuestionTemplateId",
        "displayOrder",
        "isActive"
      FROM "BookingQuestion"
      WHERE "practiceLocationId" = ${practiceLocationId}
      ORDER BY "id"
      FOR UPDATE
    `);
    const templateIds = new Set(templates.map((template) => template.id));
    const local = existing.filter(
      (question) =>
        !question.sourceDoctorBookingQuestionTemplateId ||
        !templateIds.has(question.sourceDoctorBookingQuestionTemplateId),
    );
    const localOrders = new Set(local.map((question) => question.displayOrder));
    for (const template of templates) {
      if (localOrders.has(template.displayOrder)) {
        throw new ConflictException(
          'A selected PracticeLocation has a location-only BookingQuestion using a Doctor-default display order. Resolve the display order before applying defaults.',
        );
      }
    }
    const activeCount =
      local.filter((question) => question.isActive).length +
      templates.filter((template) => template.isActive).length;
    if (activeCount > MAX_ACTIVE_BOOKING_QUESTIONS) {
      throw new ConflictException(
        'Applying Doctor-wide defaults would exceed five active BookingQuestions at a selected PracticeLocation.',
      );
    }
  }

  private async upsertBookingQuestion(
    transaction: TransactionClient,
    practiceLocationId: string,
    template: {
      id: string;
      questionText: string;
      helpText: string | null;
      type: string;
      isRequired: boolean;
      displayOrder: number;
      isActive: boolean;
      estimatedMinutesAdjustment: number;
      textMaximumLength: number | null;
      numberMinimum: Prisma.Decimal | null;
      numberMaximum: Prisma.Decimal | null;
      selectOptions: Prisma.JsonValue | null;
    },
  ): Promise<string> {
    const existing = await transaction.$queryRaw<ExistingTemplateQuestion[]>(
      Prisma.sql`
        SELECT
          q."id",
          q."questionText",
          q."type"::text AS "type",
          q."selectOptions",
          q."displayOrder",
          (
            EXISTS (
              SELECT 1 FROM "BookingDraftAnswer" bda
              WHERE bda."bookingQuestionId" = q."id"
            )
            OR EXISTS (
              SELECT 1 FROM "AppointmentAnswer" aa
              WHERE aa."bookingQuestionId" = q."id"
            )
          ) AS "hasHistory"
        FROM "BookingQuestion" q
        WHERE q."practiceLocationId" = ${practiceLocationId}
          AND q."sourceDoctorBookingQuestionTemplateId" = ${template.id}
        ORDER BY q."isActive" DESC, q."createdAt" DESC, q."id" DESC
        LIMIT 1
        FOR UPDATE
      `,
    );
    const current = existing[0];
    const selectOptions = JSON.stringify(template.selectOptions);

    if (current) {
      const protectedMeaningChanged =
        current.questionText !== template.questionText ||
        current.type !== template.type ||
        JSON.stringify(current.selectOptions ?? null) !==
          JSON.stringify(template.selectOptions ?? null);

      if (current.hasHistory && protectedMeaningChanged) {
        const nextOrderRows = await transaction.$queryRaw<
          Array<{ nextOrder: number }>
        >(Prisma.sql`
          SELECT COALESCE(MAX("displayOrder"), -1) + 1 AS "nextOrder"
          FROM "BookingQuestion"
          WHERE "practiceLocationId" = ${practiceLocationId}
        `);
        const historicalDisplayOrder = nextOrderRows[0]?.nextOrder ?? 0;
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "BookingQuestion"
          SET
            "isActive" = FALSE,
            "displayOrder" = ${historicalDisplayOrder},
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${current.id}
        `);

        const replacementId = randomUUID();
        await this.insertBookingQuestion(
          transaction,
          replacementId,
          practiceLocationId,
          template,
          selectOptions,
        );
        return replacementId;
      }

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "BookingQuestion"
        SET
          "questionText" = ${template.questionText},
          "helpText" = ${template.helpText},
          "type" = ${template.type}::"BookingQuestionType",
          "isRequired" = ${template.isRequired},
          "displayOrder" = ${template.displayOrder},
          "isActive" = ${template.isActive},
          "estimatedMinutesAdjustment" = ${template.estimatedMinutesAdjustment},
          "textMaximumLength" = ${template.textMaximumLength},
          "numberMinimum" = ${template.numberMinimum},
          "numberMaximum" = ${template.numberMaximum},
          "selectOptions" = ${selectOptions}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${current.id}
      `);
      return current.id;
    }

    const id = randomUUID();
    await this.insertBookingQuestion(
      transaction,
      id,
      practiceLocationId,
      template,
      selectOptions,
    );
    return id;
  }

  private async insertBookingQuestion(
    transaction: TransactionClient,
    id: string,
    practiceLocationId: string,
    template: {
      id: string;
      questionText: string;
      helpText: string | null;
      type: string;
      isRequired: boolean;
      displayOrder: number;
      isActive: boolean;
      estimatedMinutesAdjustment: number;
      textMaximumLength: number | null;
      numberMinimum: Prisma.Decimal | null;
      numberMaximum: Prisma.Decimal | null;
    },
    selectOptions: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "BookingQuestion" (
        "id",
        "practiceLocationId",
        "sourceDoctorBookingQuestionTemplateId",
        "questionText",
        "helpText",
        "type",
        "isRequired",
        "displayOrder",
        "isActive",
        "estimatedMinutesAdjustment",
        "textMaximumLength",
        "numberMinimum",
        "numberMaximum",
        "selectOptions",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${practiceLocationId},
        ${template.id},
        ${template.questionText},
        ${template.helpText},
        ${template.type}::"BookingQuestionType",
        ${template.isRequired},
        ${template.displayOrder},
        ${template.isActive},
        ${template.estimatedMinutesAdjustment},
        ${template.textMaximumLength},
        ${template.numberMinimum},
        ${template.numberMaximum},
        ${selectOptions}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
  }

  private async insertAuditItem(
    transaction: TransactionClient,
    targetAuditId: string,
    itemKind: 'SERVICE' | 'BOOKING_QUESTION',
    sourceTemplateId: string,
    targetConfigurationId: string,
  ) {
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "DoctorDefaultsApplyAuditItem"
        ("id", "doctorDefaultsApplyAuditTargetId", "itemKind", "sourceTemplateId", "targetConfigurationId")
      VALUES
        (${randomUUID()}, ${targetAuditId}, ${itemKind}, ${sourceTemplateId}, ${targetConfigurationId})
    `);
  }

  private async lockTargetLocations(
    transaction: TransactionClient,
    targetIds: string[],
  ) {
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "PracticeLocation"
      WHERE "id" IN (${Prisma.join(targetIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${commandIdentityKey}))`,
    );
  }

  private assertEligibleDoctor(
    actor: {
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
      doctorProfile: { id: string } | null;
    } | null,
  ) {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      !actor.doctorProfile ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible active Doctor may apply Doctor-wide defaults.',
      );
    }
  }

  private normalizeTargetIds(values: string[]) {
    const unique = [...new Set(values)].sort();
    if (unique.length === 0) {
      throw new BadRequestException(
        'At least one PracticeLocation must be selected.',
      );
    }
    if (unique.length !== values.length) {
      throw new BadRequestException(
        'PracticeLocation selections must not contain duplicates.',
      );
    }
    return unique;
  }

  private normalizeIdempotencyKey(value: string) {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 100) {
      throw new BadRequestException(
        'A valid Idempotency-Key header is required.',
      );
    }
    return normalized;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
