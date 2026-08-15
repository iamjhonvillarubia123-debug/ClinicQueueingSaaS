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
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  CommandType,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssignSubstituteSecretaryDto } from './dto/assign-substitute-secretary.dto';
import { EndSubstituteSecretaryDto } from './dto/end-substitute-secretary.dto';
import { ReplaceSubstituteSecretaryDto } from './dto/replace-substitute-secretary.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedClinicDay = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
  currentRegularPracticeStaffId: string | null;
  doctorUserId: string;
};

type EligibleStaff = {
  id: string;
  userId: string;
  practiceLocationId: string;
  staffRole: PracticeStaffRole;
  isActive: boolean;
  userRole: UserRole;
  userAccountStatus: UserAccountStatus;
  emailVerifiedAt: Date | null;
};

@Injectable()
export class SubstituteSecretaryService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(
    authenticatedUserId: string,
    dto: AssignSubstituteSecretaryDto,
    idempotencyKey: string,
  ) {
    return this.applySubstitute(
      authenticatedUserId,
      dto.clinicDayId,
      dto.userId,
      idempotencyKey,
      CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY,
    );
  }

  async replace(
    authenticatedUserId: string,
    dto: ReplaceSubstituteSecretaryDto,
    idempotencyKey: string,
  ) {
    return this.applySubstitute(
      authenticatedUserId,
      dto.clinicDayId,
      dto.userId,
      idempotencyKey,
      CommandType.CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY,
    );
  }

  async end(
    authenticatedUserId: string,
    dto: EndSubstituteSecretaryDto,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.CLINIC_DAY_END_SUBSTITUTE_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.clinicDayId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.clinicDayId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const clinicDay = await this.lockClinicDay(transaction, dto.clinicDayId);
      await this.lockUser(transaction, authenticatedUserId);
      await this.assertOwningDoctor(
        transaction,
        authenticatedUserId,
        clinicDay,
      );

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { ended: true, replayed: true };
      }

      this.assertClinicDayAllowsStaffing(clinicDay.status);
      if (!clinicDay.operatingPracticeStaffId) {
        throw new ConflictException(
          'Clinic day has no active substitute secretary to end.',
        );
      }
      if (
        clinicDay.currentRegularPracticeStaffId &&
        clinicDay.operatingPracticeStaffId ===
          clinicDay.currentRegularPracticeStaffId
      ) {
        throw new ConflictException(
          'Clinic day is currently operating under the regular secretary, not a substitute.',
        );
      }

      const regular = clinicDay.currentRegularPracticeStaffId
        ? await this.lockStaffById(
            transaction,
            clinicDay.currentRegularPracticeStaffId,
          )
        : null;
      const restoredRegularId =
        regular && this.isOperationallyReady(regular) ? regular.id : null;
      const now = new Date();

      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: restoredRegularId },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: restoredRegularId
            ? ClinicDayOperatingStaffChangeType.REPLACED
            : ClinicDayOperatingStaffChangeType.CLEARED,
          previousOperatingPracticeStaffId: clinicDay.operatingPracticeStaffId,
          newOperatingPracticeStaffId: restoredRegularId,
          actorUserId: authenticatedUserId,
          createdAt: now,
        },
      });
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          actorUserId: authenticatedUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        ended: true,
        replayed: false,
        restoredRegularSecretary: restoredRegularId !== null,
      };
    });
  }

  private async applySubstitute(
    authenticatedUserId: string,
    clinicDayId: string,
    secretaryUserId: string,
    idempotencyKey: string,
    commandType:
      | typeof CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY
      | typeof CommandType.CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${clinicDayId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${clinicDayId}|${secretaryUserId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const clinicDay = await this.lockClinicDay(transaction, clinicDayId);
      await this.lockUsers(transaction, [authenticatedUserId, secretaryUserId]);
      await this.assertOwningDoctor(
        transaction,
        authenticatedUserId,
        clinicDay,
      );

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
          commandType,
        };
      }

      this.assertClinicDayAllowsStaffing(clinicDay.status);
      const substitute = await this.lockStaffByUserAndLocation(
        transaction,
        secretaryUserId,
        clinicDay.practiceLocationId,
      );
      if (!substitute || !this.isOperationallyReady(substitute)) {
        throw new ForbiddenException(
          'Selected secretary is not operationally ready for this practice location.',
        );
      }
      if (clinicDay.currentRegularPracticeStaffId === substitute.id) {
        throw new ConflictException(
          'The current regular secretary cannot be assigned as a substitute.',
        );
      }

      const currentOperatingId = clinicDay.operatingPracticeStaffId;
      if (
        commandType === CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY &&
        currentOperatingId &&
        currentOperatingId !== clinicDay.currentRegularPracticeStaffId
      ) {
        throw new ConflictException(
          'A substitute secretary is already active for this clinic day. Use Replace Substitute instead.',
        );
      }
      if (
        commandType === CommandType.CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY &&
        (!currentOperatingId ||
          currentOperatingId === clinicDay.currentRegularPracticeStaffId)
      ) {
        throw new ConflictException(
          'Clinic day has no active substitute secretary to replace.',
        );
      }
      if (currentOperatingId === substitute.id) {
        throw new ConflictException(
          'The selected secretary is already the operating secretary for this clinic day.',
        );
      }

      const now = new Date();
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: substitute.id },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: currentOperatingId
            ? ClinicDayOperatingStaffChangeType.REPLACED
            : ClinicDayOperatingStaffChangeType.ASSIGNED,
          previousOperatingPracticeStaffId: currentOperatingId,
          newOperatingPracticeStaffId: substitute.id,
          actorUserId: authenticatedUserId,
          createdAt: now,
        },
      });
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          actorUserId: authenticatedUserId,
          accountUserId: secretaryUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        assigned: true,
        replayed: false,
        commandType,
      };
    });
  }

  private async lockClinicDay(
    transaction: TransactionClient,
    clinicDayId: string,
  ): Promise<LockedClinicDay> {
    const rows = await transaction.$queryRaw<LockedClinicDay[]>(Prisma.sql`
      SELECT
        cd."id",
        cd."practiceLocationId",
        cd."serviceDate",
        cd."status",
        cd."operatingPracticeStaffId",
        pl."currentRegularPracticeStaffId",
        dp."userId" AS "doctorUserId"
      FROM "ClinicDay" cd
      INNER JOIN "PracticeLocation" pl
        ON pl."id" = cd."practiceLocationId"
      INNER JOIN "DoctorProfile" dp
        ON dp."id" = pl."doctorProfileId"
      WHERE cd."id" = ${clinicDayId}
      LIMIT 1
      FOR UPDATE OF cd, pl
    `);
    const clinicDay = rows[0];
    if (!clinicDay) {
      throw new NotFoundException('Clinic day was not found.');
    }
    return clinicDay;
  }

  private async lockStaffByUserAndLocation(
    transaction: TransactionClient,
    userId: string,
    practiceLocationId: string,
  ): Promise<EligibleStaff | null> {
    const rows = await transaction.$queryRaw<EligibleStaff[]>(Prisma.sql`
      SELECT
        ps."id",
        ps."userId",
        ps."practiceLocationId",
        ps."staffRole",
        ps."isActive",
        u."role" AS "userRole",
        u."accountStatus" AS "userAccountStatus",
        u."emailVerifiedAt"
      FROM "PracticeStaff" ps
      INNER JOIN "User" u ON u."id" = ps."userId"
      WHERE ps."userId" = ${userId}
        AND ps."practiceLocationId" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF ps, u
    `);
    return rows[0] ?? null;
  }

  private async lockStaffById(
    transaction: TransactionClient,
    practiceStaffId: string,
  ): Promise<EligibleStaff | null> {
    const rows = await transaction.$queryRaw<EligibleStaff[]>(Prisma.sql`
      SELECT
        ps."id",
        ps."userId",
        ps."practiceLocationId",
        ps."staffRole",
        ps."isActive",
        u."role" AS "userRole",
        u."accountStatus" AS "userAccountStatus",
        u."emailVerifiedAt"
      FROM "PracticeStaff" ps
      INNER JOIN "User" u ON u."id" = ps."userId"
      WHERE ps."id" = ${practiceStaffId}
      LIMIT 1
      FOR UPDATE OF ps, u
    `);
    return rows[0] ?? null;
  }

  private isOperationallyReady(staff: EligibleStaff): boolean {
    return (
      staff.staffRole === PracticeStaffRole.SECRETARY &&
      staff.isActive &&
      staff.userRole === UserRole.SECRETARY &&
      staff.userAccountStatus === UserAccountStatus.ACTIVE &&
      staff.emailVerifiedAt !== null
    );
  }

  private async assertOwningDoctor(
    transaction: TransactionClient,
    authenticatedUserId: string,
    clinicDay: LockedClinicDay,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: { id: authenticatedUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
      },
    });
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      clinicDay.doctorUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may manage substitute secretary authority.',
      );
    }
  }

  private assertClinicDayAllowsStaffing(status: ClinicDayStatus): void {
    if (
      status === ClinicDayStatus.CLOSED ||
      status === ClinicDayStatus.CANCELLED
    ) {
      throw new ConflictException(
        'A terminal clinic day cannot change operating secretary authority.',
      );
    }
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async lockUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<void> {
    await this.lockUsers(transaction, [userId]);
  }

  private async lockUsers(
    transaction: TransactionClient,
    userIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(userIds)].sort();
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${Prisma.join(uniqueIds)})
      ORDER BY "id"
      FOR UPDATE
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
}
