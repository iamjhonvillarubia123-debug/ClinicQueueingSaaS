import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountPermanentClosureType,
  ApplicationNotificationType,
  CommandType,
  PracticeStaffCapabilityStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { normalizeEmail } from '../auth/security/session-security';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type ActiveAssignment = {
  id: string;
  practiceLocationId: string;
  doctorUserId: string;
};

type OperatingClinicDay = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  operatingPracticeStaffId: string;
};

@Injectable()
export class SecretaryLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async disable(userId: string, idempotencyKey: string) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);

    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.SECRETARY_DISABLE_ACCOUNT;
      const commandIdentityKey = this.hash(`${commandType}|${userId}|${key}`);
      const requestFingerprint = this.hash(`${commandType}|${userId}`);

      await this.acquireCommandLock(transaction, commandIdentityKey);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { disabled: true, replayed: true };
      }

      await this.lockUser(transaction, userId);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
        },
      });

      if (
        !user ||
        user.role !== UserRole.SECRETARY ||
        user.accountStatus !== UserAccountStatus.ACTIVE
      ) {
        throw new ConflictException(
          'Secretary account cannot be disabled from its current state.',
        );
      }

      const assignments = await this.lockActiveAssignments(
        transaction,
        user.id,
      );
      const now = new Date();
      await this.removeCurrentAuthority(transaction, user.id, assignments, now);

      await transaction.user.update({
        where: { id: user.id },
        data: { accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED },
      });

      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          actorUserId: user.id,
          accountUserId: user.id,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
        select: { id: true },
      });

      await this.createAssignmentLossNotifications(
        transaction,
        assignments,
        ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED,
        user.id,
        commandIdentityKey,
        command.id,
        now,
      );

      return { disabled: true, replayed: false };
    });
  }

  async reactivate(email: string, password: string, idempotencyKey: string) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const normalizedEmail = normalizeEmail(email);

    const currentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: UserRole.SECRETARY,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (!currentUser) {
      throw new UnauthorizedException('Unable to reactivate account.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.SECRETARY_REACTIVATE_ACCOUNT;
      const commandIdentityKey = this.hash(
        `${commandType}|${currentUser.id}|${key}`,
      );
      const requestFingerprint = this.hash(`${commandType}|${currentUser.id}`);

      await this.acquireCommandLock(transaction, commandIdentityKey);
      await this.lockUser(transaction, currentUser.id);

      const user = await transaction.user.findUnique({
        where: { id: currentUser.id },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          passwordHash: true,
        },
      });

      if (!user || user.role !== UserRole.SECRETARY) {
        throw new UnauthorizedException('Unable to reactivate account.');
      }

      const passwordMatches = await this.passwordSecurityService.verify(
        password,
        user.passwordHash,
      );
      if (!passwordMatches) {
        throw new UnauthorizedException('Unable to reactivate account.');
      }

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { reactivated: true, replayed: true };
      }

      if (user.accountStatus !== UserAccountStatus.VOLUNTARILY_DISABLED) {
        throw new ConflictException(
          'Secretary account cannot be reactivated from its current state.',
        );
      }

      const now = new Date();
      await transaction.user.update({
        where: { id: user.id },
        data: { accountStatus: UserAccountStatus.ACTIVE },
      });

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          actorUserId: null,
          accountUserId: user.id,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return { reactivated: true, replayed: false };
    });
  }

  async permanentlyDelete(
    email: string,
    password: string,
    confirmPermanentDelete: boolean,
    idempotencyKey: string,
  ) {
    if (!confirmPermanentDelete) {
      throw new BadRequestException(
        'Explicit irreversible confirmation is required.',
      );
    }

    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const normalizedEmail = normalizeEmail(email);

    const target = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: UserRole.SECRETARY,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!target) {
      throw new UnauthorizedException('Unable to permanently close account.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.SECRETARY_DELETE_ACCOUNT;
      const commandIdentityKey = this.hash(
        `${commandType}|${target.id}|${key}`,
      );
      const requestFingerprint = this.hash(
        `${commandType}|${target.id}|confirmed`,
      );

      await this.acquireCommandLock(transaction, commandIdentityKey);
      await this.lockUser(transaction, target.id);

      const user = await transaction.user.findUnique({
        where: { id: target.id },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          passwordHash: true,
        },
      });

      if (!user || user.role !== UserRole.SECRETARY) {
        throw new UnauthorizedException('Unable to permanently close account.');
      }

      const passwordMatches = await this.passwordSecurityService.verify(
        password,
        user.passwordHash,
      );
      if (!passwordMatches) {
        throw new UnauthorizedException('Unable to permanently close account.');
      }

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { permanentlyClosed: true, replayed: true };
      }

      if (
        user.accountStatus !== UserAccountStatus.ACTIVE &&
        user.accountStatus !== UserAccountStatus.VOLUNTARILY_DISABLED
      ) {
        throw new ConflictException(
          'Secretary account cannot be permanently closed from its current state.',
        );
      }

      const assignments = await this.lockActiveAssignments(
        transaction,
        user.id,
      );
      const now = new Date();
      await this.removeCurrentAuthority(transaction, user.id, assignments, now);

      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          actorUserId: user.id,
          accountUserId: user.id,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
        select: { id: true },
      });

      await transaction.user.update({
        where: { id: user.id },
        data: { accountStatus: UserAccountStatus.PERMANENTLY_CLOSED },
      });

      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await transaction.accountPermanentClosureAudit.create({
        data: {
          accountUserId: user.id,
          initiatedByUserId: user.id,
          closureType: AccountPermanentClosureType.SECRETARY_PERMANENT_CLOSURE,
          previousAccountStatus: user.accountStatus,
          occurredAt: now,
          commandIdempotencyId: command.id,
        },
      });

      await this.createAssignmentLossNotifications(
        transaction,
        assignments,
        ApplicationNotificationType.SECRETARY_ACCOUNT_DELETED,
        user.id,
        commandIdentityKey,
        command.id,
        now,
      );

      return { permanentlyClosed: true, replayed: false };
    });
  }

  private async lockActiveAssignments(
    transaction: TransactionClient,
    userId: string,
  ): Promise<ActiveAssignment[]> {
    return transaction.$queryRaw<ActiveAssignment[]>(Prisma.sql`
      SELECT
        ps."id",
        ps."practiceLocationId",
        dp."userId" AS "doctorUserId"
      FROM "PracticeStaff" ps
      INNER JOIN "PracticeLocation" pl
        ON pl."id" = ps."practiceLocationId"
      INNER JOIN "DoctorProfile" dp
        ON dp."id" = pl."doctorProfileId"
      WHERE ps."userId" = ${userId}
        AND ps."isActive" = TRUE
      ORDER BY ps."id"
      FOR UPDATE OF ps, pl
    `);
  }

  private async removeCurrentAuthority(
    transaction: TransactionClient,
    actorUserId: string,
    assignments: ActiveAssignment[],
    now: Date,
  ): Promise<void> {
    const assignmentIds = assignments.map((assignment) => assignment.id);
    if (assignmentIds.length === 0) {
      return;
    }

    const operatingClinicDays = await transaction.$queryRaw<
      OperatingClinicDay[]
    >(Prisma.sql`
      SELECT
        cd."id",
        cd."practiceLocationId",
        cd."serviceDate",
        cd."operatingPracticeStaffId"
      FROM "ClinicDay" cd
      WHERE cd."operatingPracticeStaffId" IN (${Prisma.join(assignmentIds)})
      ORDER BY cd."id"
      FOR UPDATE
    `);

    for (const clinicDay of operatingClinicDays) {
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "ClinicDayOperatingStaffAudit" (
          "id",
          "clinicDayId",
          "practiceLocationId",
          "serviceDate",
          "changeType",
          "previousOperatingPracticeStaffId",
          "newOperatingPracticeStaffId",
          "actorUserId",
          "createdAt"
        ) VALUES (
          ${randomUUID()},
          ${clinicDay.id},
          ${clinicDay.practiceLocationId},
          ${clinicDay.serviceDate},
          'CLEARED'::"ClinicDayOperatingStaffChangeType",
          ${clinicDay.operatingPracticeStaffId},
          NULL,
          ${actorUserId},
          ${now}
        )
      `);
    }

    await transaction.clinicDay.updateMany({
      where: { operatingPracticeStaffId: { in: assignmentIds } },
      data: { operatingPracticeStaffId: null },
    });

    await transaction.practiceLocation.updateMany({
      where: { currentRegularPracticeStaffId: { in: assignmentIds } },
      data: { currentRegularPracticeStaffId: null },
    });

    await transaction.practiceStaffCapability.updateMany({
      where: {
        practiceStaffId: { in: assignmentIds },
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });

    await transaction.practiceStaff.updateMany({
      where: { id: { in: assignmentIds }, isActive: true },
      data: { isActive: false },
    });
  }

  private async createAssignmentLossNotifications(
    transaction: TransactionClient,
    assignments: ActiveAssignment[],
    notificationType: ApplicationNotificationType,
    affectedSecretaryUserId: string,
    commandIdentityKey: string,
    commandIdempotencyId: string,
    now: Date,
  ): Promise<void> {
    for (const assignment of assignments) {
      await transaction.applicationNotification.create({
        data: {
          recipientUserId: assignment.doctorUserId,
          notificationType,
          affectedSecretaryUserId,
          practiceLocationId: assignment.practiceLocationId,
          notificationIdentityKey: this.hash(
            `${notificationType}|${affectedSecretaryUserId}|${assignment.practiceLocationId}|${commandIdentityKey}`,
          ),
          commandIdempotencyId,
          createdAt: now,
        },
      });
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

  private async lockUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
      FOR UPDATE
    `;
  }

  private assertCompatibleReplay(
    storedFingerprint: string,
    currentFingerprint: string,
  ): void {
    if (storedFingerprint !== currentFingerprint) {
      throw new ConflictException(
        'Idempotency-Key conflicts with an earlier request.',
      );
    }
  }
}
