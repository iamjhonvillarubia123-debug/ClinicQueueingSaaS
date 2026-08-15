import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeAccountActionType,
  AdministrativeReasonCategory,
  AdministrativeRestrictionStatus,
  CommandType,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicDayCancellationService } from '../queue/clinic-day-cancellation.service';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type UnresolvedNormalSuspension = {
  id: string;
  targetDoctorUserId: string;
};

@Injectable()
export class SystemAdminEmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly clinicDayCancellationService: ClinicDayCancellationService,
  ) {}

  async emergencySuspendDoctor(
    actorUserId: string,
    targetDoctorUserId: string,
    reasonCategory: AdministrativeReasonCategory,
    explanation: string,
    adminPassword: string,
    confirmStopOperations: boolean,
    idempotencyKey: string,
  ) {
    if (!confirmStopOperations) {
      throw new BadRequestException(
        'Explicit emergency stop confirmation is required.',
      );
    }

    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const normalizedExplanation = explanation.trim();
    if (!normalizedExplanation) {
      throw new BadRequestException('Emergency explanation is required.');
    }

    const commandType = CommandType.SYSTEM_ADMIN_EMERGENCY_SUSPEND_DOCTOR;
    const commandIdentityKey = this.hash(
      `${commandType}|${actorUserId}|${targetDoctorUserId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${actorUserId}|${targetDoctorUserId}|${reasonCategory}|${normalizedExplanation}|confirmed`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      await this.lockUsers(transaction, [actorUserId, targetDoctorUserId]);

      const [actor, target] = await Promise.all([
        transaction.user.findUnique({
          where: { id: actorUserId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
            passwordHash: true,
          },
        }),
        transaction.user.findUnique({
          where: { id: targetDoctorUserId },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
          },
        }),
      ]);

      this.assertCurrentSystemAdmin(actor);
      await this.assertFreshAdminPassword(adminPassword, actor.passwordHash);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        const action = await this.loadReplayAction(
          transaction,
          replay.resultAdministrativeAccountActionId,
          targetDoctorUserId,
        );
        const stoppedClinicDayCount =
          await transaction.administrativeAccountActionScope.count({
            where: { administrativeAccountActionId: action.id },
          });
        return {
          emergencySuspended: true,
          replayed: true,
          administrativeAccountActionId: action.id,
          stoppedClinicDayCount,
        };
      }

      if (
        !target ||
        target.role !== UserRole.DOCTOR ||
        target.accountStatus === UserAccountStatus.PERMANENTLY_CLOSED ||
        (target.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE &&
          target.administrativeRestrictionStatus !==
            AdministrativeRestrictionStatus.SUSPENDED)
      ) {
        throw new ConflictException(
          'Doctor account cannot be emergency suspended from its current state.',
        );
      }

      if (
        target.administrativeRestrictionStatus ===
        AdministrativeRestrictionStatus.SUSPENDED
      ) {
        await this.assertUnresolvedNormalSuspension(transaction, target.id);
      }

      const now = new Date();
      const action = await transaction.administrativeAccountAction.create({
        data: {
          actionType: AdministrativeAccountActionType.EMERGENCY_SUSPENSION,
          actorUserId: actor.id,
          targetDoctorUserId: target.id,
          reasonCategory,
          explanation: normalizedExplanation,
          occurredAt: now,
        },
        select: { id: true },
      });

      await transaction.user.update({
        where: { id: target.id },
        data: {
          administrativeRestrictionStatus:
            AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED,
        },
      });

      await transaction.userSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now },
      });

      const shutdown =
        await this.clinicDayCancellationService.cancelDoctorOperationsForEmergency(
          transaction,
          target.id,
          actor.id,
          action.id,
          now,
        );

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          actorUserId: actor.id,
          accountUserId: target.id,
          resultAdministrativeAccountActionId: action.id,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        emergencySuspended: true,
        replayed: false,
        administrativeAccountActionId: action.id,
        stoppedClinicDayCount: shutdown.stoppedClinicDayCount,
      };
    });
  }

  private async assertUnresolvedNormalSuspension(
    transaction: TransactionClient,
    targetDoctorUserId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<UnresolvedNormalSuspension[]>(
      Prisma.sql`
        SELECT suspension."id", suspension."targetDoctorUserId"
        FROM "AdministrativeAccountAction" suspension
        WHERE suspension."targetDoctorUserId" = ${targetDoctorUserId}
          AND suspension."actionType" = 'NORMAL_SUSPENSION'::"AdministrativeAccountActionType"
          AND NOT EXISTS (
            SELECT 1
            FROM "AdministrativeAccountAction" restoration
            WHERE restoration."restoresActionId" = suspension."id"
          )
        ORDER BY suspension."occurredAt" DESC, suspension."id" DESC
        LIMIT 1
        FOR UPDATE OF suspension
      `,
    );
    if (!rows[0] || rows[0].targetDoctorUserId !== targetDoctorUserId) {
      throw new ConflictException(
        'Emergency escalation requires a matching unresolved normal suspension.',
      );
    }
  }

  private assertCurrentSystemAdmin(
    actor: {
      id: string;
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
      passwordHash: string;
    } | null,
  ): asserts actor is {
    id: string;
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    passwordHash: string;
  } {
    if (
      !actor ||
      actor.role !== UserRole.SYSTEM_ADMIN ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('SYSTEM_ADMIN authority is required.');
    }
  }

  private async assertFreshAdminPassword(
    adminPassword: string,
    passwordHash: string,
  ): Promise<void> {
    const passwordMatches = await this.passwordSecurityService.verify(
      adminPassword,
      passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Step-up authentication failed.');
    }
  }

  private async loadReplayAction(
    transaction: TransactionClient,
    actionId: string | null,
    expectedTargetDoctorUserId: string,
  ): Promise<{ id: string }> {
    if (!actionId) {
      throw new InternalServerErrorException(
        'Stored administrative command result is inconsistent.',
      );
    }
    const action = await transaction.administrativeAccountAction.findUnique({
      where: { id: actionId },
      select: { id: true, actionType: true, targetDoctorUserId: true },
    });
    if (
      !action ||
      action.actionType !==
        AdministrativeAccountActionType.EMERGENCY_SUSPENSION ||
      action.targetDoctorUserId !== expectedTargetDoctorUserId
    ) {
      throw new InternalServerErrorException(
        'Stored administrative command result is inconsistent.',
      );
    }
    return { id: action.id };
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

  private async lockUsers(
    transaction: TransactionClient,
    userIds: string[],
  ): Promise<void> {
    const orderedUserIds = [...new Set(userIds)].sort();
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${Prisma.join(orderedUserIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
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
