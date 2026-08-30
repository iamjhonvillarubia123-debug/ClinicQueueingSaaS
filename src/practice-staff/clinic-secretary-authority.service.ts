import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AdministrativeRestrictionStatus,
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  PracticeStaffCapabilityStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';
import { RemoveRegularSecretaryDto } from './dto/remove-regular-secretary.dto';
import { ReplaceRegularSecretaryDto } from './dto/replace-regular-secretary.dto';
import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedPracticeLocation = {
  id: string;
  doctorUserId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  currentRegularPracticeStaffId: string | null;
};

type StaffAssignment = {
  id: string;
  userId: string;
  practiceLocationId: string;
  staffRole: PracticeStaffRole;
  isActive: boolean;
};

type SecretaryIdentity = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  emailVerifiedAt: Date | null;
};

type DoctorIdentity = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  passwordHash?: string;
};

type ClinicDayContinuity = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
};

@Injectable()
export class ClinicSecretaryAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async assign(
    authenticatedUserId: string,
    dto: AssignPracticeStaffDto,
    idempotencyKey: string,
  ) {
    const bundles = this.normalizeBundles(dto.authorityBundles);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}|${bundles.join(',')}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const actor = await this.readDoctor(transaction, authenticatedUserId, false);
      const secretary = await this.readSecretary(transaction, dto.userId);
      this.assertCurrentDoctor(actor);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        return {
          assigned: true,
          replayed: true,
          practiceStaffId: location.currentRegularPracticeStaffId,
          authorityBundles: bundles,
        };
      }

      this.assertLocationCanHaveClinicSecretary(location);
      this.assertEligibleSecretary(secretary);
      if (location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location already has a current Clinic Secretary. Use Replace Clinic Secretary instead.',
        );
      }

      const now = new Date();
      const assignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
        now,
      );
      await this.replaceActiveBundles(
        transaction,
        assignment.id,
        bundles,
        authenticatedUserId,
        now,
      );

      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: { currentRegularPracticeStaffId: assignment.id },
      });

      await this.assignToUnstaffedStartedClinicDays(
        transaction,
        location.id,
        assignment.id,
        authenticatedUserId,
        now,
      );

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: location.id,
          actorUserId: authenticatedUserId,
          accountUserId: dto.userId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        assigned: true,
        replayed: false,
        practiceStaffId: assignment.id,
        authorityBundles: bundles,
      };
    });
  }

  async replace(
    authenticatedUserId: string,
    dto: ReplaceRegularSecretaryDto,
    idempotencyKey: string,
  ) {
    const bundles = this.normalizeBundles(dto.authorityBundles);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_REPLACE_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}|${bundles.join(',')}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const actor = await this.readDoctor(transaction, authenticatedUserId, true);
      const secretary = await this.readSecretary(transaction, dto.userId);
      this.assertCurrentDoctor(actor);
      await this.assertPassword(dto.password, actor?.passwordHash);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        const current = await this.lockAssignmentByUserAndLocation(
          transaction,
          dto.userId,
          dto.practiceLocationId,
        );
        return {
          replaced: true,
          replayed: true,
          practiceStaffId: current?.id ?? null,
          authorityBundles: bundles,
        };
      }

      this.assertLocationCanHaveClinicSecretary(location);
      this.assertEligibleSecretary(secretary);
      if (!location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location has no current Clinic Secretary. Use Assign Clinic Secretary instead.',
        );
      }

      const previousAssignment = await this.lockAssignmentById(
        transaction,
        location.currentRegularPracticeStaffId,
      );
      if (!previousAssignment) {
        throw new ConflictException('Current Clinic Secretary assignment is unavailable.');
      }
      if (previousAssignment.userId === dto.userId) {
        throw new ConflictException(
          'The selected Secretary is already the current Clinic Secretary.',
        );
      }

      const now = new Date();
      const newAssignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
        now,
      );
      await this.replaceActiveBundles(
        transaction,
        newAssignment.id,
        bundles,
        authenticatedUserId,
        now,
      );

      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: { currentRegularPracticeStaffId: newAssignment.id },
      });

      await this.reconcileOutgoingOperatingAuthority(
        transaction,
        location.id,
        previousAssignment.id,
        newAssignment.id,
        authenticatedUserId,
        now,
      );
      await this.deactivateAssignment(
        transaction,
        previousAssignment.id,
        authenticatedUserId,
        now,
      );

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: location.id,
          actorUserId: authenticatedUserId,
          accountUserId: dto.userId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        replaced: true,
        replayed: false,
        practiceStaffId: newAssignment.id,
        authorityBundles: bundles,
        disabledPracticeStaffId: previousAssignment.id,
      };
    });
  }

  async remove(
    authenticatedUserId: string,
    dto: RemoveRegularSecretaryDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_REMOVE_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId]);
      const actor = await this.readDoctor(transaction, authenticatedUserId, true);
      this.assertCurrentDoctor(actor);
      await this.assertPassword(dto.password, actor?.passwordHash);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
        return { removed: true, replayed: true };
      }

      this.assertLocationCanHaveClinicSecretary(location);
      if (!location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location has no current Clinic Secretary to remove.',
        );
      }

      const previousAssignment = await this.lockAssignmentById(
        transaction,
        location.currentRegularPracticeStaffId,
      );
      if (!previousAssignment) {
        throw new ConflictException('Current Clinic Secretary assignment is unavailable.');
      }

      const now = new Date();
      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: { currentRegularPracticeStaffId: null },
      });
      await this.reconcileOutgoingOperatingAuthority(
        transaction,
        location.id,
        previousAssignment.id,
        null,
        authenticatedUserId,
        now,
      );
      await this.deactivateAssignment(
        transaction,
        previousAssignment.id,
        authenticatedUserId,
        now,
      );

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: location.id,
          actorUserId: authenticatedUserId,
          accountUserId: previousAssignment.userId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        removed: true,
        replayed: false,
        disabledPracticeStaffId: previousAssignment.id,
      };
    });
  }

  private normalizeBundles(
    values?: ClinicSecretaryAuthorityBundle[],
  ): ClinicSecretaryAuthorityBundle[] {
    if (!Array.isArray(values) || values.length === 0) {
      throw new BadRequestException(
        'At least one Clinic Secretary authority bundle is required.',
      );
    }
    const allowed = new Set(Object.values(ClinicSecretaryAuthorityBundle));
    const unique = [...new Set(values)];
    if (unique.some((value) => !allowed.has(value))) {
      throw new BadRequestException('Unsupported Clinic Secretary authority bundle.');
    }
    return unique.sort();
  }

  private async replaceActiveBundles(
    transaction: TransactionClient,
    practiceStaffId: string,
    bundles: ClinicSecretaryAuthorityBundle[],
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "PracticeStaffAuthorityBundle"
      SET
        "status" = 'REVOKED'::"PracticeStaffAuthorityBundleStatus",
        "revokedByUserId" = ${actorUserId},
        "revokedAt" = ${now}
      WHERE "practiceStaffId" = ${practiceStaffId}
        AND "status" = 'ACTIVE'::"PracticeStaffAuthorityBundleStatus"
    `);

    for (const bundle of bundles) {
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "PracticeStaffAuthorityBundle" (
          "id",
          "practiceStaffId",
          "bundleType",
          "status",
          "grantedByUserId",
          "grantedAt",
          "createdAt"
        ) VALUES (
          ${randomUUID()},
          ${practiceStaffId},
          CAST(${bundle} AS "PracticeStaffAuthorityBundleType"),
          'ACTIVE'::"PracticeStaffAuthorityBundleStatus",
          ${actorUserId},
          ${now},
          ${now}
        )
      `);
    }
  }

  private async prepareAssignment(
    transaction: TransactionClient,
    userId: string,
    practiceLocationId: string,
    now: Date,
  ): Promise<StaffAssignment> {
    const existing = await this.lockAssignmentByUserAndLocation(
      transaction,
      userId,
      practiceLocationId,
    );
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
        "id",
        "userId",
        "practiceLocationId",
        "staffRole",
        "isActive",
        "createdAt",
        "updatedAt",
        "activatedAt",
        "deactivatedAt"
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

  private async deactivateAssignment(
    transaction: TransactionClient,
    practiceStaffId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    await transaction.practiceStaffCapability.updateMany({
      where: {
        practiceStaffId,
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "PracticeStaffAuthorityBundle"
      SET
        "status" = 'REVOKED'::"PracticeStaffAuthorityBundleStatus",
        "revokedByUserId" = ${actorUserId},
        "revokedAt" = ${now}
      WHERE "practiceStaffId" = ${practiceStaffId}
        AND "status" = 'ACTIVE'::"PracticeStaffAuthorityBundleStatus"
    `);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "PracticeStaff"
      SET
        "isActive" = FALSE,
        "deactivatedAt" = ${now},
        "updatedAt" = ${now}
      WHERE "id" = ${practiceStaffId}
    `);
  }

  private async assignToUnstaffedStartedClinicDays(
    transaction: TransactionClient,
    practiceLocationId: string,
    newPracticeStaffId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const clinicDays = await transaction.$queryRaw<ClinicDayContinuity[]>(Prisma.sql`
      SELECT
        "id", "practiceLocationId", "serviceDate", "status", "operatingPracticeStaffId"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "status" = 'STARTED'::"ClinicDayStatus"
        AND "operatingPracticeStaffId" IS NULL
      ORDER BY "id"
      FOR UPDATE
    `);
    for (const clinicDay of clinicDays) {
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: newPracticeStaffId },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: ClinicDayOperatingStaffChangeType.ASSIGNED,
          previousOperatingPracticeStaffId: null,
          newOperatingPracticeStaffId: newPracticeStaffId,
          actorUserId,
          createdAt: now,
        },
      });
    }
  }

  private async reconcileOutgoingOperatingAuthority(
    transaction: TransactionClient,
    practiceLocationId: string,
    previousPracticeStaffId: string,
    replacementPracticeStaffId: string | null,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const clinicDays = await transaction.$queryRaw<ClinicDayContinuity[]>(Prisma.sql`
      SELECT
        "id", "practiceLocationId", "serviceDate", "status", "operatingPracticeStaffId"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "operatingPracticeStaffId" = ${previousPracticeStaffId}
        AND "status" IN (
          'NOT_STARTED'::"ClinicDayStatus",
          'DELAYED'::"ClinicDayStatus",
          'STARTED'::"ClinicDayStatus"
        )
      ORDER BY "id"
      FOR UPDATE
    `);
    for (const clinicDay of clinicDays) {
      const isLiveReplacement =
        clinicDay.status === ClinicDayStatus.STARTED &&
        replacementPracticeStaffId !== null;
      const newOperatingPracticeStaffId = isLiveReplacement
        ? replacementPracticeStaffId
        : null;
      const changeType = isLiveReplacement
        ? ClinicDayOperatingStaffChangeType.REPLACED
        : ClinicDayOperatingStaffChangeType.CLEARED;
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: newOperatingPracticeStaffId },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType,
          previousOperatingPracticeStaffId: previousPracticeStaffId,
          newOperatingPracticeStaffId,
          actorUserId,
          createdAt: now,
        },
      });
    }
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
        pl."lifecycleStatus",
        pl."currentRegularPracticeStaffId"
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

  private async lockAssignmentById(
    transaction: TransactionClient,
    practiceStaffId: string,
  ): Promise<StaffAssignment | null> {
    const rows = await transaction.$queryRaw<StaffAssignment[]>(Prisma.sql`
      SELECT "id", "userId", "practiceLocationId", "staffRole", "isActive"
      FROM "PracticeStaff"
      WHERE "id" = ${practiceStaffId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockAssignmentByUserAndLocation(
    transaction: TransactionClient,
    userId: string,
    practiceLocationId: string,
  ): Promise<StaffAssignment | null> {
    const rows = await transaction.$queryRaw<StaffAssignment[]>(Prisma.sql`
      SELECT "id", "userId", "practiceLocationId", "staffRole", "isActive"
      FROM "PracticeStaff"
      WHERE "userId" = ${userId}
        AND "practiceLocationId" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async readDoctor(
    transaction: TransactionClient,
    userId: string,
    includePasswordHash: boolean,
  ): Promise<DoctorIdentity | null> {
    return transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        ...(includePasswordHash ? { passwordHash: true } : {}),
      },
    }) as Promise<DoctorIdentity | null>;
  }

  private async readSecretary(
    transaction: TransactionClient,
    userId: string,
  ): Promise<SecretaryIdentity | null> {
    return transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        emailVerifiedAt: true,
      },
    });
  }

  private assertCurrentDoctor(actor: DoctorIdentity | null): void {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible current Doctor may manage Clinic Secretary authority.',
      );
    }
  }

  private assertEligibleSecretary(secretary: SecretaryIdentity | null): void {
    if (
      !secretary ||
      secretary.role !== UserRole.SECRETARY ||
      secretary.accountStatus !== UserAccountStatus.ACTIVE ||
      secretary.emailVerifiedAt === null
    ) {
      throw new ForbiddenException(
        'Only an active verified Secretary may be assigned as Clinic Secretary.',
      );
    }
  }

  private assertLocationCanHaveClinicSecretary(
    location: LockedPracticeLocation,
  ): void {
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

  private async assertPassword(
    password: string,
    passwordHash: string | undefined,
  ): Promise<void> {
    if (
      !passwordHash ||
      !(await this.passwordSecurityService.verify(password, passwordHash))
    ) {
      throw new UnauthorizedException('Current password is invalid.');
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
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }
}
