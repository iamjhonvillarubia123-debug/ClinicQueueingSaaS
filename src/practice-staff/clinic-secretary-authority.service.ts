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
import { UpdateClinicSecretaryAuthorityDto } from './dto/update-clinic-secretary-authority.dto';
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
    const requestedCancelClinicDay = dto.requestedCancelClinicDay === true;
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}|${bundles.join(',')}|cancel:${requestedCancelClinicDay}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const actor = await this.readDoctor(
        transaction,
        authenticatedUserId,
        requestedCancelClinicDay,
      );
      const secretary = await this.readSecretary(transaction, dto.userId);
      this.assertCurrentDoctor(actor);
      if (requestedCancelClinicDay) {
        if (!dto.password) {
          throw new UnauthorizedException(
            'Current password is required to grant Cancel Clinic Day authority.',
          );
        }
        await this.assertPassword(dto.password, actor?.passwordHash);
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
          assigned: true,
          replayed: true,
          practiceStaffId: location.currentRegularPracticeStaffId,
          authorityBundles: bundles,
          cancelClinicDayAllowed: requestedCancelClinicDay,
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
      await this.replaceCancelClinicDayCapability(
        transaction,
        assignment.id,
        requestedCancelClinicDay,
        authenticatedUserId,
        now,
      );

      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: { currentRegularPracticeStaffId: assignment.id },
      });

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
        cancelClinicDayAllowed: requestedCancelClinicDay,
      };
    });
  }

  async replace(
    authenticatedUserId: string,
    dto: ReplaceRegularSecretaryDto,
    idempotencyKey: string,
  ) {
    const bundles = this.normalizeBundles(dto.authorityBundles);
    const requestedCancelClinicDay = dto.requestedCancelClinicDay === true;
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_REPLACE_REGULAR_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${dto.userId}|${bundles.join(',')}|cancel:${requestedCancelClinicDay}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        dto.practiceLocationId,
      );
      await this.lockUsers(transaction, [authenticatedUserId, dto.userId]);

      const actor = await this.readDoctor(
        transaction,
        authenticatedUserId,
        true,
      );
      const secretary = await this.readSecretary(transaction, dto.userId);
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
          cancelClinicDayAllowed: requestedCancelClinicDay,
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
        throw new ConflictException(
          'Current Clinic Secretary assignment is unavailable.',
        );
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
      await this.replaceCancelClinicDayCapability(
        transaction,
        newAssignment.id,
        requestedCancelClinicDay,
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
        cancelClinicDayAllowed: requestedCancelClinicDay,
        disabledPracticeStaffId: previousAssignment.id,
      };
    });
  }

  async updateAuthority(
    authenticatedUserId: string,
    practiceStaffId: string,
    dto: UpdateClinicSecretaryAuthorityDto,
  ) {
    const bundles = this.normalizeBundles(dto.authorityBundles);
    return this.prisma.$transaction(async (transaction) => {
      const owned = await transaction.practiceStaff.findFirst({
        where: {
          id: practiceStaffId,
          disconnectedAt: null,
          practiceLocation: {
            doctorProfile: { userId: authenticatedUserId },
          },
        },
        select: { id: true, practiceLocationId: true },
      });
      if (!owned)
        throw new NotFoundException(
          'Clinic Secretary assignment was not found.',
        );

      const location = await this.lockOwnedPracticeLocation(
        transaction,
        authenticatedUserId,
        owned.practiceLocationId,
      );
      const assignment = await this.lockAssignmentById(
        transaction,
        practiceStaffId,
      );
      const actor = await this.readDoctor(
        transaction,
        authenticatedUserId,
        false,
      );
      this.assertCurrentDoctor(actor);
      if (
        !assignment ||
        !assignment.isActive ||
        assignment.staffRole !== PracticeStaffRole.SECRETARY ||
        location.currentRegularPracticeStaffId !== assignment.id
      )
        throw new ConflictException(
          'Only the active Clinic Secretary authority can be edited.',
        );

      const now = new Date();
      await this.replaceActiveBundles(
        transaction,
        assignment.id,
        bundles,
        authenticatedUserId,
        now,
      );
      return {
        practiceStaffId: assignment.id,
        updated: true,
        authorityBundles: bundles,
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
      const actor = await this.readDoctor(
        transaction,
        authenticatedUserId,
        false,
      );
      this.assertCurrentDoctor(actor);

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
        throw new ConflictException(
          'Current Clinic Secretary assignment is unavailable.',
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

  async disconnectRelationship(
    authenticatedUserId: string,
    practiceStaffId: string,
    password: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.practiceStaff.findFirst({
        where: {
          id: practiceStaffId,
          disconnectedAt: null,
          practiceLocation: {
            doctorProfile: { userId: authenticatedUserId },
          },
        },
        select: {
          id: true,
          practiceLocationId: true,
          practiceLocation: { select: { currentRegularPracticeStaffId: true } },
        },
      });
      if (!assignment)
        throw new NotFoundException(
          'Secretary clinic connection was not found.',
        );

      const actor = await this.readDoctor(
        transaction,
        authenticatedUserId,
        true,
      );
      this.assertCurrentDoctor(actor);
      await this.assertPassword(password, actor?.passwordHash);
      const now = new Date();

      if (
        assignment.practiceLocation.currentRegularPracticeStaffId ===
        assignment.id
      ) {
        await transaction.practiceLocation.update({
          where: { id: assignment.practiceLocationId },
          data: { currentRegularPracticeStaffId: null },
        });
      }
      await this.reconcileOutgoingOperatingAuthority(
        transaction,
        assignment.practiceLocationId,
        assignment.id,
        authenticatedUserId,
        now,
      );
      await transaction.practiceStaffCapability.updateMany({
        where: { practiceStaffId: assignment.id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          activeCapabilityKey: null,
          revokedByUserId: authenticatedUserId,
          revokedAt: now,
        },
      });
      await transaction.practiceStaffAuthorityBundle.updateMany({
        where: { practiceStaffId: assignment.id, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedByUserId: authenticatedUserId,
          revokedAt: now,
        },
      });
      const activeCoverages =
        await transaction.substituteSecretaryCoverage.findMany({
          where: { practiceStaffId: assignment.id, status: 'ACTIVE' },
          select: { id: true },
        });
      const activeCoverageIds = activeCoverages.map(({ id }) => id);
      if (activeCoverageIds.length) {
        await transaction.substituteSecretaryCoverageDate.updateMany({
          where: { coverageId: { in: activeCoverageIds }, status: 'ACTIVE' },
          data: { status: 'CANCELLED', endedAt: now },
        });
        await transaction.substituteSecretaryCoverage.updateMany({
          where: { id: { in: activeCoverageIds } },
          data: {
            status: 'CANCELLED',
            endedByUserId: authenticatedUserId,
            endedAt: now,
          },
        });
      }
      await transaction.practiceStaff.update({
        where: { id: assignment.id },
        data: {
          isActive: false,
          deactivatedAt: now,
          disconnectedAt: now,
        },
      });
      return { practiceStaffId: assignment.id, removed: true };
    });
  }

  async getRemovalImpact(authenticatedUserId: string, practiceStaffId: string) {
    const assignment = await this.prisma.practiceStaff.findFirst({
      where: {
        id: practiceStaffId,
        disconnectedAt: null,
        practiceLocation: {
          doctorProfile: { userId: authenticatedUserId },
        },
      },
      select: {
        id: true,
        isActive: true,
        practiceLocationId: true,
        practiceLocation: {
          select: {
            name: true,
            currentRegularPracticeStaffId: true,
          },
        },
        substituteSecretaryCoverages: {
          where: { status: 'ACTIVE' },
          orderBy: { fromServiceDate: 'asc' },
          select: {
            id: true,
            coverageMode: true,
            fromServiceDate: true,
            toServiceDate: true,
          },
        },
        authoredSecretarySettingsDrafts: {
          where: {
            status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED_FOR_REWORK'] },
          },
          select: { id: true, status: true },
        },
      },
    });
    if (!assignment)
      throw new NotFoundException('Secretary clinic connection was not found.');

    const operatingClinicDays = await this.prisma.clinicDay.findMany({
      where: {
        operatingPracticeStaffId: assignment.id,
        status: { in: ['NOT_STARTED', 'DELAYED', 'STARTED'] },
      },
      orderBy: { serviceDate: 'asc' },
      select: { id: true, serviceDate: true, status: true },
    });
    const isCurrentClinicSecretary =
      assignment.practiceLocation.currentRegularPracticeStaffId ===
      assignment.id;
    const relevantDates = [
      ...new Set([
        ...operatingClinicDays.map(({ serviceDate }) =>
          serviceDate.toISOString().slice(0, 10),
        ),
        ...assignment.substituteSecretaryCoverages.flatMap((coverage) => {
          const dates: string[] = [];
          const cursor = new Date(coverage.fromServiceDate);
          while (cursor <= coverage.toServiceDate) {
            dates.push(cursor.toISOString().slice(0, 10));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }
          return dates;
        }),
      ]),
    ];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const appointmentWhere: Prisma.AppointmentWhereInput = {
      practiceLocationId: assignment.practiceLocationId,
      status: {
        in: ['WAITING', 'CALLED', 'TEMPORARILY_ABSENT', 'OUT_FOR_PROCEDURE'],
      },
      ...(isCurrentClinicSecretary
        ? { serviceDate: { gte: today } }
        : relevantDates.length
          ? {
              serviceDate: {
                in: relevantDates.map(
                  (value) => new Date(`${value}T00:00:00.000Z`),
                ),
              },
            }
          : { id: { equals: '__none__' } }),
    };
    const bookedAppointmentCount = await this.prisma.appointment.count({
      where: appointmentWhere,
    });

    return {
      practiceStaffId: assignment.id,
      clinicName: assignment.practiceLocation.name,
      assignmentActive: assignment.isActive,
      isCurrentClinicSecretary,
      clinicWillHaveNoCurrentSecretary: isCurrentClinicSecretary,
      operatingClinicDays: operatingClinicDays.map((day) => ({
        serviceDate: day.serviceDate.toISOString().slice(0, 10),
        status: day.status,
      })),
      activeSubstituteCoverages: assignment.substituteSecretaryCoverages.map(
        (coverage) => ({
          coverageMode: coverage.coverageMode,
          fromServiceDate: coverage.fromServiceDate.toISOString().slice(0, 10),
          toServiceDate: coverage.toServiceDate.toISOString().slice(0, 10),
        }),
      ),
      pendingConfigurationDraftCount:
        assignment.authoredSecretarySettingsDrafts.length,
      bookedAppointmentCount,
      bookingsRemainScheduled: true,
      auditHistoryPreserved: true,
    };
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
      throw new BadRequestException(
        'Unsupported Clinic Secretary authority bundle.',
      );
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

  private async replaceCancelClinicDayCapability(
    transaction: TransactionClient,
    practiceStaffId: string,
    allowCancelClinicDay: boolean,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    await transaction.practiceStaffCapability.updateMany({
      where: {
        practiceStaffId,
        capabilityType: 'CANCEL_CLINIC_DAY',
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    if (!allowCancelClinicDay) return;
    await transaction.practiceStaffCapability.create({
      data: {
        practiceStaffId,
        capabilityType: 'CANCEL_CLINIC_DAY',
        status: PracticeStaffCapabilityStatus.ACTIVE,
        activeCapabilityKey: this.hash(
          `${practiceStaffId}:CANCEL_CLINIC_DAY`,
        ),
        grantedByUserId: actorUserId,
        grantedAt: now,
        createdAt: now,
      },
    });
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
            "disconnectedAt" = NULL,
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

  private async reconcileOutgoingOperatingAuthority(
    transaction: TransactionClient,
    practiceLocationId: string,
    previousPracticeStaffId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const clinicDays = await transaction.$queryRaw<
      ClinicDayContinuity[]
    >(Prisma.sql`
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
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: null },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: ClinicDayOperatingStaffChangeType.CLEARED,
          previousOperatingPracticeStaffId: previousPracticeStaffId,
          newOperatingPracticeStaffId: null,
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
    const rows = await transaction.$queryRaw<
      LockedPracticeLocation[]
    >(Prisma.sql`
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
    });
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
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
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
      location.lifecycleStatus ===
      PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
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
