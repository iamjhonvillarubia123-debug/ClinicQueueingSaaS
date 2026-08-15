import { createHash, randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  ApplicationNotificationType,
  CommandType,
  PracticeStaffCapabilityStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
        this.assertCompatibleReplay(replay.requestFingerprint, requestFingerprint);
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

      const assignments = await transaction.$queryRaw<ActiveAssignment[]>(Prisma.sql`
        SELECT
          ps."id",
          ps."practiceLocationId",
          dp."userId" AS "doctorUserId"
        FROM "PracticeStaff" ps
        INNER JOIN "PracticeLocation" pl
          ON pl."id" = ps."practiceLocationId"
        INNER JOIN "DoctorProfile" dp
          ON dp."id" = pl."doctorProfileId"
        WHERE ps."userId" = ${user.id}
          AND ps."isActive" = TRUE
        ORDER BY ps."id"
        FOR UPDATE OF ps, pl
      `);

      const now = new Date();
      const assignmentIds = assignments.map((assignment) => assignment.id);

      let operatingClinicDays: OperatingClinicDay[] = [];
      if (assignmentIds.length > 0) {
        operatingClinicDays = await transaction.$queryRaw<OperatingClinicDay[]>(
          Prisma.sql`
            SELECT
              cd."id",
              cd."practiceLocationId",
              cd."serviceDate",
              cd."operatingPracticeStaffId"
            FROM "ClinicDay" cd
            WHERE cd."operatingPracticeStaffId" IN (${Prisma.join(assignmentIds)})
            ORDER BY cd."id"
            FOR UPDATE
          `,
        );

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
              ${user.id},
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
            revokedByUserId: user.id,
            revokedAt: now,
          },
        });

        await transaction.practiceStaff.updateMany({
          where: { id: { in: assignmentIds }, isActive: true },
          data: { isActive: false },
        });
      }

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

      for (const assignment of assignments) {
        await transaction.applicationNotification.create({
          data: {
            recipientUserId: assignment.doctorUserId,
            notificationType: ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED,
            affectedSecretaryUserId: user.id,
            practiceLocationId: assignment.practiceLocationId,
            notificationIdentityKey: this.hash(
              `${ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED}|${user.id}|${assignment.practiceLocationId}|${commandIdentityKey}`,
            ),
            commandIdempotencyId: command.id,
            createdAt: now,
          },
        });
      }

      return { disabled: true, replayed: false };
    });
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
