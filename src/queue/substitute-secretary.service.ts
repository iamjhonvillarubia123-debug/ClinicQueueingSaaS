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
  PracticeLocationLifecycleStatus,
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
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
};

type LockedLocation = {
  id: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
};

type ClinicDayScope = {
  practiceLocationId: string;
  serviceDate: Date;
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
    if (dto.clinicDayId) {
      if (dto.practiceLocationId || dto.serviceDate) {
        throw new BadRequestException(
          'Provide either clinicDayId or practiceLocationId with serviceDate, not both.',
        );
      }
      return this.applyOperatingSecretary(
        authenticatedUserId,
        dto.clinicDayId,
        dto.userId,
        idempotencyKey,
        CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY,
      );
    }
    if (!dto.practiceLocationId || !dto.serviceDate) {
      throw new BadRequestException(
        'practiceLocationId and serviceDate are required when clinicDayId is not provided.',
      );
    }
    return this.assignForServiceDate(
      authenticatedUserId,
      dto.practiceLocationId,
      dto.serviceDate,
      dto.userId,
      idempotencyKey,
    );
  }

  async replace(
    authenticatedUserId: string,
    dto: ReplaceSubstituteSecretaryDto,
    idempotencyKey: string,
  ) {
    return this.applyOperatingSecretary(
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
      const scope = await this.readClinicDayScope(transaction, dto.clinicDayId);
      await this.acquireClinicDayScopeLock(
        transaction,
        scope.practiceLocationId,
        this.formatServiceDate(scope.serviceDate),
      );
      const clinicDay = await this.lockClinicDay(transaction, dto.clinicDayId);
      this.assertClinicDayScopeUnchanged(clinicDay, scope);
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
        return { cleared: true, replayed: true };
      }

      this.assertClinicDayAllowsAssignmentOrClear(clinicDay.status);
      if (!clinicDay.operatingPracticeStaffId) {
        throw new ConflictException(
          'Clinic day has no operating secretary to clear.',
        );
      }

      const previousOperatingPracticeStaffId =
        clinicDay.operatingPracticeStaffId;
      const now = new Date();

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
          previousOperatingPracticeStaffId,
          newOperatingPracticeStaffId: null,
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

      return { cleared: true, replayed: false };
    });
  }

  private async assignForServiceDate(
    authenticatedUserId: string,
    practiceLocationId: string,
    serviceDateInput: string,
    secretaryUserId: string,
    idempotencyKey: string,
  ) {
    const serviceDate = this.parseServiceDate(serviceDateInput);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${practiceLocationId}|${serviceDateInput}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${practiceLocationId}|${serviceDateInput}|${secretaryUserId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      await this.acquireClinicDayScopeLock(
        transaction,
        practiceLocationId,
        serviceDateInput,
      );
      await this.lockUsers(transaction, [authenticatedUserId, secretaryUserId]);
      const location = await this.lockLocation(transaction, practiceLocationId);
      await this.assertOwningDoctorForLocation(
        transaction,
        authenticatedUserId,
        location,
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

      const clinicDay = await this.lockClinicDayByScope(
        transaction,
        practiceLocationId,
        serviceDate,
      );
      if (!clinicDay) {
        throw new ConflictException(
          'No actual Clinic Day exists for this Service Date. Create Substitute Secretary coverage instead.',
        );
      }

      this.assertClinicDayAllowsAssignmentOrClear(clinicDay.status);
      if (clinicDay.operatingPracticeStaffId) {
        throw new ConflictException(
          'Clinic day already has an operating secretary. Use Replace Operating Secretary.',
        );
      }

      const selectedStaff = await this.lockStaffByUserAndLocation(
        transaction,
        secretaryUserId,
        practiceLocationId,
      );
      if (!selectedStaff || !this.isOperationallyReady(selectedStaff)) {
        throw new ForbiddenException(
          'Selected secretary is not operationally ready for this practice location.',
        );
      }

      const now = new Date();
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: selectedStaff.id },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId,
          serviceDate,
          changeType: ClinicDayOperatingStaffChangeType.ASSIGNED,
          previousOperatingPracticeStaffId: null,
          newOperatingPracticeStaffId: selectedStaff.id,
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
          practiceLocationId,
          serviceDate,
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
        clinicDayId: clinicDay.id,
      };
    });
  }

  private async applyOperatingSecretary(
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
      const scope = await this.readClinicDayScope(transaction, clinicDayId);
      await this.acquireClinicDayScopeLock(
        transaction,
        scope.practiceLocationId,
        this.formatServiceDate(scope.serviceDate),
      );
      const clinicDay = await this.lockClinicDay(transaction, clinicDayId);
      this.assertClinicDayScopeUnchanged(clinicDay, scope);
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

      if (commandType === CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY) {
        this.assertClinicDayAllowsAssignmentOrClear(clinicDay.status);
        if (clinicDay.operatingPracticeStaffId) {
          throw new ConflictException(
            'Clinic day already has an operating secretary. Use Replace Operating Secretary.',
          );
        }
      } else {
        this.assertClinicDayAllowsReplacement(clinicDay.status);
        if (!clinicDay.operatingPracticeStaffId) {
          throw new ConflictException(
            'Clinic day has no operating secretary to replace.',
          );
        }
      }

      const selectedStaff = await this.lockStaffByUserAndLocation(
        transaction,
        secretaryUserId,
        clinicDay.practiceLocationId,
      );
      if (!selectedStaff || !this.isOperationallyReady(selectedStaff)) {
        throw new ForbiddenException(
          'Selected secretary is not operationally ready for this practice location.',
        );
      }
      if (clinicDay.operatingPracticeStaffId === selectedStaff.id) {
        throw new ConflictException(
          'The selected secretary is already the operating secretary for this clinic day.',
        );
      }

      const previousOperatingPracticeStaffId =
        clinicDay.operatingPracticeStaffId;
      const now = new Date();
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: selectedStaff.id },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: previousOperatingPracticeStaffId
            ? ClinicDayOperatingStaffChangeType.REPLACED
            : ClinicDayOperatingStaffChangeType.ASSIGNED,
          previousOperatingPracticeStaffId,
          newOperatingPracticeStaffId: selectedStaff.id,
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
        pl."lifecycleStatus",
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

  private async readClinicDayScope(
    transaction: TransactionClient,
    clinicDayId: string,
  ): Promise<ClinicDayScope> {
    const rows = await transaction.$queryRaw<ClinicDayScope[]>(Prisma.sql`
      SELECT "practiceLocationId", "serviceDate"
      FROM "ClinicDay"
      WHERE "id" = ${clinicDayId}
      LIMIT 1
    `);
    const scope = rows[0];
    if (!scope) {
      throw new NotFoundException('Clinic day was not found.');
    }
    return scope;
  }

  private assertClinicDayScopeUnchanged(
    clinicDay: LockedClinicDay,
    scope: ClinicDayScope,
  ): void {
    if (
      clinicDay.practiceLocationId !== scope.practiceLocationId ||
      this.formatServiceDate(clinicDay.serviceDate) !==
        this.formatServiceDate(scope.serviceDate)
    ) {
      throw new ConflictException(
        'Clinic day scope changed while operating authority was being updated.',
      );
    }
  }

  private async lockClinicDayByScope(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<LockedClinicDay | null> {
    const rows = await transaction.$queryRaw<LockedClinicDay[]>(Prisma.sql`
      SELECT
        cd."id",
        cd."practiceLocationId",
        cd."serviceDate",
        cd."status",
        cd."operatingPracticeStaffId",
        pl."lifecycleStatus",
        dp."userId" AS "doctorUserId"
      FROM "ClinicDay" cd
      INNER JOIN "PracticeLocation" pl
        ON pl."id" = cd."practiceLocationId"
      INNER JOIN "DoctorProfile" dp
        ON dp."id" = pl."doctorProfileId"
      WHERE cd."practiceLocationId" = ${practiceLocationId}
        AND cd."serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE OF cd, pl
    `);
    return rows[0] ?? null;
  }

  private async lockLocation(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<LockedLocation> {
    const rows = await transaction.$queryRaw<LockedLocation[]>(Prisma.sql`
      SELECT
        pl."id",
        pl."lifecycleStatus",
        dp."userId" AS "doctorUserId"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp
        ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const location = rows[0];
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    return location;
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
    this.assertOperationalLocation(clinicDay.lifecycleStatus);
    await this.assertOwningDoctorIdentity(
      transaction,
      authenticatedUserId,
      clinicDay.doctorUserId,
    );
  }

  private async assertOwningDoctorForLocation(
    transaction: TransactionClient,
    authenticatedUserId: string,
    location: LockedLocation,
  ): Promise<void> {
    this.assertOperationalLocation(location.lifecycleStatus);
    await this.assertOwningDoctorIdentity(
      transaction,
      authenticatedUserId,
      location.doctorUserId,
    );
  }

  private async assertOwningDoctorIdentity(
    transaction: TransactionClient,
    authenticatedUserId: string,
    doctorUserId: string,
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
      doctorUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may manage operating secretary authority.',
      );
    }
  }

  private assertOperationalLocation(
    lifecycleStatus: PracticeLocationLifecycleStatus,
  ): void {
    if (lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE) {
      throw new ConflictException(
        'Practice location is not active for operating secretary assignment.',
      );
    }
  }

  private assertClinicDayAllowsAssignmentOrClear(
    status: ClinicDayStatus,
  ): void {
    if (
      status === ClinicDayStatus.CLOSED ||
      status === ClinicDayStatus.CANCELLED
    ) {
      throw new ConflictException(
        'A terminal clinic day cannot change operating secretary authority.',
      );
    }
  }

  private assertClinicDayAllowsReplacement(status: ClinicDayStatus): void {
    if (status !== ClinicDayStatus.STARTED) {
      throw new ConflictException(
        'Operating Secretary replacement is allowed only after the clinic day has started.',
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

  private async acquireClinicDayScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: string,
  ): Promise<void> {
    const scope = `clinic-day-operating-secretary|${practiceLocationId}|${serviceDate}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
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

  private parseServiceDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('serviceDate must use YYYY-MM-DD.');
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('serviceDate is invalid.');
    }
    return date;
  }

  private formatServiceDate(value: Date): string {
    return value.toISOString().slice(0, 10);
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
