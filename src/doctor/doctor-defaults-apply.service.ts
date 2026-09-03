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
      JSON.stringify([
        commandType,
        authenticatedUserId,
        targetIds,
        dto.serviceTemplateIds ? [...dto.serviceTemplateIds].sort() : 'ALL',
        dto.bookingQuestionTemplateIds
          ? [...dto.bookingQuestionTemplateIds].sort()
          : 'ALL',
      ]),
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${authenticatedUserId} FOR UPDATE`,
      );
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

      const [allServices, allQuestions] = await Promise.all([
        transaction.doctorServiceTemplate.findMany({
          where: { doctorProfileId },
          orderBy: { id: 'asc' },
        }),
        transaction.doctorBookingQuestionTemplate.findMany({
          where: { doctorProfileId },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);

      const selectTemplates = <T extends { id: string }>(
        all: T[],
        ids: string[] | undefined,
      ): T[] => {
        if (ids === undefined) return all;
        if (
          !Array.isArray(ids) ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !all.some((item) => item.id === id))
        ) {
          throw new BadRequestException(
            'Select only your own existing default templates, without duplicates.',
          );
        }
        return all.filter((item) => ids.includes(item.id));
      };
      const serviceTemplates = selectTemplates(
        allServices,
        dto.serviceTemplateIds,
      );
      const questionTemplates = selectTemplates(
        allQuestions,
        dto.bookingQuestionTemplateIds,
      );
      if (!serviceTemplates.length && !questionTemplates.length) {
        throw new BadRequestException('Select at least one default template.');
      }
      const questionPlans = new Map<
        string,
        Awaited<ReturnType<typeof this.validateQuestionResult>>
      >();
      for (const practiceLocationId of targetIds) {
        questionPlans.set(
          practiceLocationId,
          await this.validateQuestionResult(
            transaction,
            practiceLocationId,
            questionTemplates,
          ),
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
          // Existing source-linked configuration is owned by the clinic from now on.
          if (existing) continue;
          const target = await transaction.practiceLocationService.create({
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

        const plan = questionPlans.get(practiceLocationId)!;
        let displayOrder = plan.nextOrder;
        for (const template of questionTemplates) {
          if (!plan.missingIds.has(template.id)) continue;
          const targetId = await this.insertBookingQuestion(
            transaction,
            practiceLocationId,
            { ...template, displayOrder: displayOrder++ },
            JSON.stringify(template.selectOptions),
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
    const sourceIds = new Set(
      existing.map(
        (question) => question.sourceDoctorBookingQuestionTemplateId,
      ),
    );
    const missing = templates.filter((template) => !sourceIds.has(template.id));
    const activeCount =
      existing.filter((question) => question.isActive).length +
      missing.filter((template) => template.isActive).length;
    if (activeCount > MAX_ACTIVE_BOOKING_QUESTIONS) {
      throw new ConflictException(
        'Copying these defaults would exceed five active booking questions at a selected clinic. Select fewer questions. No clinics have been changed.',
      );
    }
    return {
      missingIds: new Set(missing.map((template) => template.id)),
      nextOrder:
        Math.max(-1, ...existing.map((question) => question.displayOrder)) + 1,
    };
  }

  private async insertBookingQuestion(
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
    },
    selectOptions: string,
  ): Promise<string> {
    const id = randomUUID();
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
    return id;
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
    await transaction.$executeRaw(
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
