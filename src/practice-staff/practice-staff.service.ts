import { createHash } from 'crypto';
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

type ClinicDayContinuity = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
};

@Injectable()
export class PracticeStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async assignRegular(
    authenticatedUserId: string,
    dto: AssignPracticeStaffDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const [actor, secretary] = await Promise.all([
        transaction.user.findUnique({
          where: { id: authenticatedUserId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
          },
        }),
        transaction.user.findUnique({
          where: { id: dto.userId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
          },
        }),
      ]);

      this.assertCurrentDoctor(actor);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        const assignment = await transaction.practiceStaff.findFirst({
          where: {
            userId: dto.userId,
            practiceLocationId: dto.practiceLocationId,
          },
          select: { id: true },
        });
        return {
          assigned: true,
          replayed: true,
          practiceStaffId: assignment?.id ?? null,
        };
      }

      this.assertLocationCanHaveRegularSecretary(location);
      this.assertEligibleSecretary(secretary);

      if (location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location already has a current regular secretary. Use Replace Secretary instead.',
        );
      }

      const assignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
      );
      const now = new Date();

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
      };
    });
  }

  async replaceRegular(
    authenticatedUserId: string,
    dto: ReplaceRegularSecretaryDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_REPLACE_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const [actor, secretary] = await Promise.all([
        transaction.user.findUnique({
          where: { id: authenticatedUserId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
            passwordHash: true,
          },
        }),
        transaction.user.findUnique({
          where: { id: dto.userId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
          },
        }),
      ]);

      this.assertCurrentDoctor(actor);
      await this.assertPassword(dto.password, actor?.passwordHash);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        const assignment = await transaction.practiceStaff.findFirst({
          where: {
            userId: dto.userId,
            practiceLocationId: dto.practiceLocationId,
          },
          select: { id: true },
        });
        return {
          replaced: true,
          replayed: true,
          practiceStaffId: assignment?.id ?? null,
        };
      }

      this.assertLocationCanHaveRegularSecretary(location);
      this.assertEligibleSecretary(secretary);

      if (!location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location has no current regular secretary. Use Assign Secretary instead.',
        );
      }

      const previousAssignment = await this.lockAssignmentById(
        transaction,
        location.currentRegularPracticeStaffId,
      );
      if (!previousAssignment) {
        throw new ConflictException(
          'Current regular secretary assignment is unavailable.',
        );
      }
      if (previousAssignment.userId === dto.userId) {
        throw new ConflictException(
          'The selected secretary is already the current regular secretary.',
        );
      }

      const newAssignment = await this.prepareAssignment(
        transaction,
        dto.userId,
        location.id,
      );
      const now = new Date();

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
      };
    });
  }

  async removeRegular(
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

      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          passwordHash: true,
        },
      });
      this.assertCurrentDoctor(actor);
      await this.assertPassword(dto.password, actor?.passwordHash);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { removed: true, replayed: true };
      }

      this.assertLocationCanHaveRegularSecretary(location);
      if (!location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'Practice location has no current regular secretary to remove.',
        );
      }

      const previousAssignment = await this.lockAssignmentById(
        transaction,
        location.currentRegularPracticeStaffId,
      );
      if (!previousAssignment) {
        throw new ConflictException(
          'Current regular secretary assignment is unavailable.',
        );
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

      return { removed: true, replayed: false };
    });
  }

  private async prepareAssignment(
    transaction: TransactionClient,
    userId: string,
    practiceLocationId: string,
  ): Promise<StaffAssignment> {
    const rows = await transaction.$queryRaw<StaffAssignment[]>(Prisma.sql`
      SELECT
        "id",
        "userId",
        "practiceLocationId",
        "staffRole",
        "isActive"
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
        await transaction.practiceStaff.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      }
      return { ...existing, isActive: true };
    }

    return transaction.practiceStaff.create({
      data: {
        userId,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        practiceLocationId: true,
        staffRole: true,
        isActive: true,
      },
    });
  }

  private async assignToUnstaffedStartedClinicDays(
    transaction: TransactionClient,
    practiceLocationId: string,
    newPracticeStaffId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const clinicDays = await transaction.$queryRaw<ClinicDayContinuity[]>(
      Prisma.sql`
        SELECT
          "id",
          "practiceLocationId",
          "serviceDate",
          "status",
          "operatingPracticeStaffId"
        FROM "ClinicDay"
        WHERE "practiceLocationId" = ${practiceLocationId}
          AND "status" = 'STARTED'::"ClinicDayStatus"
          AND "operatingPracticeStaffId" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `,
    );

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
    const clinicDays = await transaction.$queryRaw<ClinicDayContinuity[]>(
      Prisma.sql`
        SELECT
          "id",
          "practiceLocationId",
          "serviceDate",
          "status",
          "operatingPracticeStaffId"
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
      `,
    );

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

    await transaction.practiceStaff.update({
      where: { id: practiceStaffId },
      data: { isActive: false },
    });
  }

  private async lockOwnedPracticeLocation(
    transaction: TransactionClient,
    actorUserId: string,
    practiceLocationId: string,
  ): Promise<LockedPracticeLocation> {
    const rows = await transaction.$queryRaw<LockedPracticeLocation[]>(
      Prisma.sql`
        SELECT
          pl."id",
          dp."userId" AS "doctorUserId",
          pl."lifecycleStatus",
          pl."currentRegularPracticeStaffId"
        FROM "PracticeLocation" pl
        INNER JOIN "DoctorProfile" dp
          ON dp."id" = pl."doctorProfileId"
        WHERE pl."id" = ${practiceLocationId}
        LIMIT 1
        FOR UPDATE OF pl
      `,
    );
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
      SELECT
        "id",
        "userId",
        "practiceLocationId",
        "staffRole",
        "isActive"
      FROM "PracticeStaff"
      WHERE "id" = ${practiceStaffId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockUsers(
    transaction: TransactionClient,
    userIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds)].sort();
    if (uniqueIds.length === 0) {
      return;
    }
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${Prisma.join(uniqueIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private assertCurrentDoctor(
    actor:
      | {
          role: UserRole;
          accountStatus: UserAccountStatus;
          administrativeRestrictionStatus: AdministrativeRestrictionStatus;
        }
      | null,
  ): void {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible current doctor may manage regular secretary authority.',
      );
    }
  }

  private assertEligibleSecretary(
    secretary:
      | {
          role: UserRole;
          accountStatus: UserAccountStatus;
        }
      | null,
  ): void {
    if (
      !secretary ||
      secretary.role !== UserRole.SECRETARY ||
      secretary.accountStatus !== UserAccountStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        'Only an eligible active secretary user may be assigned.',
      );
    }
  }

  private assertLocationCanHaveRegularSecretary(
    location: LockedPracticeLocation,
  ): void {
    if (
      location.lifecycleStatus ===
      PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
    ) {
      throw new ConflictException(
        'A permanently deleted practice location cannot receive staff authority.',
      );
    }
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
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `;
  }
}
