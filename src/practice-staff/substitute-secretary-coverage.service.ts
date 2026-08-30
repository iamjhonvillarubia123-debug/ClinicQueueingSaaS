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
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CancelSubstituteSecretaryCoverageDto } from './dto/cancel-substitute-secretary-coverage.dto';
import { CreateSubstituteSecretaryCoverageDto } from './dto/create-substitute-secretary-coverage.dto';
import { ReplaceSubstituteSecretaryCoverageDto } from './dto/replace-substitute-secretary-coverage.dto';
import {
  SubstituteSecretaryCoverageMode,
  SubstituteSecretaryCoverageStatus,
} from './substitute-secretary-coverage.types';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CREATE_COMMAND = 'PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE';
const REPLACE_COMMAND = 'PRACTICE_LOCATION_REPLACE_SUBSTITUTE_COVERAGE';
const CANCEL_COMMAND = 'PRACTICE_LOCATION_CANCEL_SUBSTITUTE_COVERAGE';

type TransactionClient = Prisma.TransactionClient;

type LockedPracticeLocation = {
  id: string;
  doctorUserId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
};

type UserIdentity = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  emailVerifiedAt: Date | null;
};

type StaffAssignment = {
  id: string;
  userId: string;
  practiceLocationId: string;
  staffRole: PracticeStaffRole;
  isActive: boolean;
};

type CoverageRow = {
  id: string;
  practiceLocationId: string;
  practiceStaffId: string;
  coverageMode: SubstituteSecretaryCoverageMode;
  fromServiceDate: Date;
  toServiceDate: Date;
  status: SubstituteSecretaryCoverageStatus;
};

type ReplayRow = {
  requestFingerprint: string;
  resultSubstituteSecretaryCoverageId: string | null;
};

type NormalizedCoverage = {
  coverageMode: SubstituteSecretaryCoverageMode;
  fromServiceDate: string;
  toServiceDate: string;
  serviceDates: string[];
};

@Injectable()
export class SubstituteSecretaryCoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    authenticatedUserId: string,
    dto: CreateSubstituteSecretaryCoverageDto,
    idempotencyKey: string,
  ) {
    const normalized = this.normalizeCoverage(dto);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandIdentityKey = this.hash(
      `${CREATE_COMMAND}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${CREATE_COMMAND}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}|${normalized.coverageMode}|${normalized.fromServiceDate}|${normalized.toServiceDate}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      await this.acquireLocationCoverageLock(transaction, dto.practiceLocationId);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);
      const actor = await this.readUser(transaction, authenticatedUserId);
      const secretary = await this.readUser(transaction, dto.userId);
      this.assertCurrentDoctor(actor);

      const replay = await this.readReplay(transaction, commandIdentityKey);
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        return {
          created: true,
          replayed: true,
          coverageId: replay.resultSubstituteSecretaryCoverageId,
        };
      }

      this.assertLocationCanHaveStaff(location);
      this.assertEligibleSecretary(secretary);
      const now = new Date();
      const assignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
        now,
      );

      await this.assertNoCoverageOverlap(
        transaction,
        location.id,
        normalized.fromServiceDate,
        normalized.toServiceDate,
      );

      const coverageId = await this.insertCoverage(
        transaction,
        location.id,
        assignment.id,
        normalized,
        authenticatedUserId,
        now,
        null,
      );
      await this.insertCommand(
        transaction,
        key,
        commandIdentityKey,
        CREATE_COMMAND,
        requestFingerprint,
        location.id,
        authenticatedUserId,
        dto.userId,
        null,
        coverageId,
        now,
      );

      return {
        created: true,
        replayed: false,
        coverageId,
        practiceStaffId: assignment.id,
        coverageMode: normalized.coverageMode,
        fromServiceDate: normalized.fromServiceDate,
        toServiceDate: normalized.toServiceDate,
      };
    });
  }

  async replace(
    authenticatedUserId: string,
    dto: ReplaceSubstituteSecretaryCoverageDto,
    idempotencyKey: string,
  ) {
    const normalized = this.normalizeCoverage(dto);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandIdentityKey = this.hash(
      `${REPLACE_COMMAND}|${authenticatedUserId}|${dto.coverageId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${REPLACE_COMMAND}|${authenticatedUserId}|${dto.coverageId}|${dto.userId}|${normalized.coverageMode}|${normalized.fromServiceDate}|${normalized.toServiceDate}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const scope = await this.readCoverageScope(transaction, dto.coverageId);
      if (!scope) {
        throw new NotFoundException('Substitute Secretary coverage was not found.');
      }
      await this.acquireLocationCoverageLock(transaction, scope.practiceLocationId);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        scope.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);
      const actor = await this.readUser(transaction, authenticatedUserId);
      const secretary = await this.readUser(transaction, dto.userId);
      this.assertCurrentDoctor(actor);

      const replay = await this.readReplay(transaction, commandIdentityKey);
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        return {
          replaced: true,
          replayed: true,
          coverageId: replay.resultSubstituteSecretaryCoverageId,
        };
      }

      this.assertLocationCanHaveStaff(location);
      this.assertEligibleSecretary(secretary);
      const current = await this.lockCoverage(transaction, dto.coverageId);
      if (
        !current ||
        current.practiceLocationId !== location.id ||
        current.status !== SubstituteSecretaryCoverageStatus.ACTIVE
      ) {
        throw new ConflictException(
          'Only an active Substitute Secretary coverage may be replaced.',
        );
      }

      const now = new Date();
      const assignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
        now,
      );

      await this.endCoverage(
        transaction,
        current.id,
        SubstituteSecretaryCoverageStatus.SUPERSEDED,
        authenticatedUserId,
        now,
      );
      await this.assertNoCoverageOverlap(
        transaction,
        location.id,
        normalized.fromServiceDate,
        normalized.toServiceDate,
      );

      const coverageId = await this.insertCoverage(
        transaction,
        location.id,
        assignment.id,
        normalized,
        authenticatedUserId,
        now,
        current.id,
      );
      await this.insertCommand(
        transaction,
        key,
        commandIdentityKey,
        REPLACE_COMMAND,
        requestFingerprint,
        location.id,
        authenticatedUserId,
        dto.userId,
        current.id,
        coverageId,
        now,
      );

      return {
        replaced: true,
        replayed: false,
        coverageId,
        supersededCoverageId: current.id,
        practiceStaffId: assignment.id,
        coverageMode: normalized.coverageMode,
        fromServiceDate: normalized.fromServiceDate,
        toServiceDate: normalized.toServiceDate,
      };
    });
  }

  async cancel(
    authenticatedUserId: string,
    dto: CancelSubstituteSecretaryCoverageDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandIdentityKey = this.hash(
      `${CANCEL_COMMAND}|${authenticatedUserId}|${dto.coverageId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${CANCEL_COMMAND}|${authenticatedUserId}|${dto.coverageId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const scope = await this.readCoverageScope(transaction, dto.coverageId);
      if (!scope) {
        throw new NotFoundException('Substitute Secretary coverage was not found.');
      }
      await this.acquireLocationCoverageLock(transaction, scope.practiceLocationId);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        scope.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId]);
      const actor = await this.readUser(transaction, authenticatedUserId);
      this.assertCurrentDoctor(actor);

      const replay = await this.readReplay(transaction, commandIdentityKey);
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        return {
          cancelled: true,
          replayed: true,
          coverageId: replay.resultSubstituteSecretaryCoverageId,
        };
      }

      this.assertLocationCanHaveStaff(location);
      const current = await this.lockCoverage(transaction, dto.coverageId);
      if (
        !current ||
        current.practiceLocationId !== location.id ||
        current.status !== SubstituteSecretaryCoverageStatus.ACTIVE
      ) {
        throw new ConflictException(
          'Only an active Substitute Secretary coverage may be cancelled.',
        );
      }

      const now = new Date();
      await this.endCoverage(
        transaction,
        current.id,
        SubstituteSecretaryCoverageStatus.CANCELLED,
        authenticatedUserId,
        now,
      );
      await this.insertCommand(
        transaction,
        key,
        commandIdentityKey,
        CANCEL_COMMAND,
        requestFingerprint,
        location.id,
        authenticatedUserId,
        null,
        current.id,
        current.id,
        now,
      );

      return {
        cancelled: true,
        replayed: false,
        coverageId: current.id,
      };
    });
  }

  private normalizeCoverage(dto: {
    coverageMode: SubstituteSecretaryCoverageMode;
    fromServiceDate: string;
    toServiceDate: string;
  }): NormalizedCoverage {
    const from = this.parseCanonicalServiceDate(dto.fromServiceDate);
    const to = this.parseCanonicalServiceDate(dto.toServiceDate);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'Substitute Secretary coverage start date must not be after the end date.',
      );
    }
    if (
      dto.coverageMode === SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE &&
      dto.fromServiceDate !== dto.toServiceDate
    ) {
      throw new BadRequestException(
        'One Clinic Day coverage must use the same start and end Service Date.',
      );
    }
    if (!Object.values(SubstituteSecretaryCoverageMode).includes(dto.coverageMode)) {
      throw new BadRequestException('Unsupported Substitute Secretary coverage mode.');
    }

    return {
      coverageMode: dto.coverageMode,
      fromServiceDate: dto.fromServiceDate,
      toServiceDate: dto.toServiceDate,
      serviceDates: this.enumerateServiceDates(from, to),
    };
  }

  private parseCanonicalServiceDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Service Date must use YYYY-MM-DD.');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Service Date is not a valid calendar date.');
    }
    return parsed;
  }

  private enumerateServiceDates(from: Date, to: Date): string[] {
    const dates: string[] = [];
    for (
      let cursor = from.getTime();
      cursor <= to.getTime();
      cursor += 24 * 60 * 60 * 1000
    ) {
      dates.push(new Date(cursor).toISOString().slice(0, 10));
    }
    return dates;
  }

  private async insertCoverage(
    transaction: TransactionClient,
    practiceLocationId: string,
    practiceStaffId: string,
    normalized: NormalizedCoverage,
    actorUserId: string,
    now: Date,
    supersedesCoverageId: string | null,
  ): Promise<string> {
    const coverageId = randomUUID();
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "SubstituteSecretaryCoverage" (
        "id", "practiceLocationId", "practiceStaffId", "coverageMode",
        "fromServiceDate", "toServiceDate", "status", "createdByUserId",
        "createdAt", "endedByUserId", "endedAt", "supersedesCoverageId"
      ) VALUES (
        ${coverageId},
        ${practiceLocationId},
        ${practiceStaffId},
        CAST(${normalized.coverageMode} AS "SubstituteSecretaryCoverageMode"),
        CAST(${normalized.fromServiceDate} AS date),
        CAST(${normalized.toServiceDate} AS date),
        'ACTIVE'::"SubstituteSecretaryCoverageStatus",
        ${actorUserId},
        ${now},
        NULL,
        NULL,
        ${supersedesCoverageId}
      )
    `);

    for (const serviceDate of normalized.serviceDates) {
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "SubstituteSecretaryCoverageDate" (
          "id", "coverageId", "practiceLocationId", "serviceDate", "status", "createdAt"
        ) VALUES (
          ${randomUUID()},
          ${coverageId},
          ${practiceLocationId},
          CAST(${serviceDate} AS date),
          'ACTIVE'::"SubstituteSecretaryCoverageStatus",
          ${now}
        )
      `);
    }
    return coverageId;
  }

  private async endCoverage(
    transaction: TransactionClient,
    coverageId: string,
    status:
      | SubstituteSecretaryCoverageStatus.CANCELLED
      | SubstituteSecretaryCoverageStatus.SUPERSEDED,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "SubstituteSecretaryCoverageDate"
      SET
        "status" = CAST(${status} AS "SubstituteSecretaryCoverageStatus"),
        "endedAt" = ${now}
      WHERE "coverageId" = ${coverageId}
        AND "status" = 'ACTIVE'::"SubstituteSecretaryCoverageStatus"
    `);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "SubstituteSecretaryCoverage"
      SET
        "status" = CAST(${status} AS "SubstituteSecretaryCoverageStatus"),
        "endedByUserId" = ${actorUserId},
        "endedAt" = ${now}
      WHERE "id" = ${coverageId}
        AND "status" = 'ACTIVE'::"SubstituteSecretaryCoverageStatus"
    `);
  }

  private async assertNoCoverageOverlap(
    transaction: TransactionClient,
    practiceLocationId: string,
    fromServiceDate: string,
    toServiceDate: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SubstituteSecretaryCoverageDate"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "status" = 'ACTIVE'::"SubstituteSecretaryCoverageStatus"
        AND "serviceDate" BETWEEN CAST(${fromServiceDate} AS date)
          AND CAST(${toServiceDate} AS date)
      LIMIT 1
      FOR UPDATE
    `);
    if (rows.length > 0) {
      throw new ConflictException(
        'Another active Substitute Secretary coverage already applies to one or more selected Service Dates.',
      );
    }
  }

  private async prepareAssignment(
    transaction: TransactionClient,
    userId: string,
    practiceLocationId: string,
    now: Date,
  ): Promise<StaffAssignment> {
    const rows = await transaction.$queryRaw<StaffAssignment[]>(Prisma.sql`
      SELECT "id", "userId", "practiceLocationId", "staffRole", "isActive"
      FROM "PracticeStaff"
      WHERE "userId" = ${userId}
        AND "practiceLocationId" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE
    `);
    const existing = rows[0];
    if (existing) {
      if (existing.staffRole !== PracticeStaffRole.SECRETARY) {
        throw new ConflictException('Existing practice staff role is invalid.');
      }
      if (!existing.isActive) {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "PracticeStaff"
          SET
            "isActive" = TRUE,
            "activatedAt" = ${now},
            "deactivatedAt" = NULL,
            "updatedAt" = ${now}
          WHERE "id" = ${existing.id}
        `);
      }
      return { ...existing, isActive: true };
    }

    const id = randomUUID();
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "PracticeStaff" (
        "id", "userId", "practiceLocationId", "staffRole", "isActive",
        "createdAt", "updatedAt", "activatedAt", "deactivatedAt"
      ) VALUES (
        ${id},
        ${userId},
        ${practiceLocationId},
        'SECRETARY'::"PracticeStaffRole",
        TRUE,
        ${now},
        ${now},
        ${now},
        NULL
      )
    `);
    return {
      id,
      userId,
      practiceLocationId,
      staffRole: PracticeStaffRole.SECRETARY,
      isActive: true,
    };
  }

  private async readCoverageScope(
    transaction: TransactionClient,
    coverageId: string,
  ): Promise<CoverageRow | null> {
    const rows = await transaction.$queryRaw<CoverageRow[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "practiceStaffId",
        "coverageMode",
        "fromServiceDate",
        "toServiceDate",
        "status"
      FROM "SubstituteSecretaryCoverage"
      WHERE "id" = ${coverageId}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async lockCoverage(
    transaction: TransactionClient,
    coverageId: string,
  ): Promise<CoverageRow | null> {
    const rows = await transaction.$queryRaw<CoverageRow[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "practiceStaffId",
        "coverageMode",
        "fromServiceDate",
        "toServiceDate",
        "status"
      FROM "SubstituteSecretaryCoverage"
      WHERE "id" = ${coverageId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockOwnedPracticeLocation(
    transaction: TransactionClient,
    actorUserId: string,
    practiceLocationId: string,
  ): Promise<LockedPracticeLocation> {
    const rows = await transaction.$queryRaw<LockedPracticeLocation[]>(Prisma.sql`
      SELECT
        pl."id",
        dp."userId" AS "doctorUserId",
        pl."lifecycleStatus"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const location = rows[0];
    if (!location || location.doctorUserId !== actorUserId) {
      throw new NotFoundException('Practice location was not found.');
    }
    return location;
  }

  private async readUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<UserIdentity | null> {
    return transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        emailVerifiedAt: true,
      },
    });
  }

  private assertCurrentDoctor(actor: UserIdentity | null): void {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible current Doctor may manage Substitute Secretary coverage.',
      );
    }
  }

  private assertEligibleSecretary(secretary: UserIdentity | null): void {
    if (
      !secretary ||
      secretary.role !== UserRole.SECRETARY ||
      secretary.accountStatus !== UserAccountStatus.ACTIVE ||
      secretary.emailVerifiedAt === null
    ) {
      throw new ForbiddenException(
        'Only an active verified Secretary may receive Substitute Secretary coverage.',
      );
    }
  }

  private assertLocationCanHaveStaff(location: LockedPracticeLocation): void {
    if (
      location.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
    ) {
      throw new ConflictException(
        'A permanently deleted Practice Location cannot receive staff authority.',
      );
    }
  }

  private async lockUsers(
    transaction: TransactionClient,
    userIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds)].sort();
    if (!uniqueIds.length) return;
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${Prisma.join(uniqueIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async readReplay(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<ReplayRow | null> {
    const rows = await transaction.$queryRaw<ReplayRow[]>(Prisma.sql`
      SELECT "requestFingerprint", "resultSubstituteSecretaryCoverageId"
      FROM "CommandIdempotency"
      WHERE "commandIdentityKey" = ${commandIdentityKey}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async insertCommand(
    transaction: TransactionClient,
    idempotencyKey: string,
    commandIdentityKey: string,
    commandType: string,
    requestFingerprint: string,
    practiceLocationId: string,
    actorUserId: string,
    accountUserId: string | null,
    substituteSecretaryCoverageId: string | null,
    resultSubstituteSecretaryCoverageId: string,
    now: Date,
  ): Promise<void> {
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "CommandIdempotency" (
        "id", "idempotencyKey", "commandIdentityKey", "commandType",
        "requestFingerprint", "practiceLocationId", "actorUserId",
        "accountUserId", "substituteSecretaryCoverageId",
        "resultSubstituteSecretaryCoverageId", "completedAt", "expiresAt", "createdAt"
      ) VALUES (
        ${randomUUID()},
        ${idempotencyKey},
        ${commandIdentityKey},
        CAST(${commandType} AS "CommandType"),
        ${requestFingerprint},
        ${practiceLocationId},
        ${actorUserId},
        ${accountUserId},
        ${substituteSecretaryCoverageId},
        ${resultSubstituteSecretaryCoverageId},
        ${now},
        ${expiresAt},
        ${now}
      )
    `);
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
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async acquireLocationCoverageLock(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<void> {
    const lockKey = `SUBSTITUTE_COVERAGE|${practiceLocationId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);
  }
}
