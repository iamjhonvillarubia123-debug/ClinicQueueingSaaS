import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountPermanentClosureType,
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { normalizeEmail } from '../auth/security/session-security';
import { PrismaService } from '../prisma/prisma.service';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class DoctorLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly protectedPayloadService: ProtectedAccountPayloadService,
  ) {}

  async disable(userId: string, idempotencyKey: string) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.DOCTOR_DISABLE_ACCOUNT;
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
          administrativeRestrictionStatus: true,
        },
      });

      if (
        !user ||
        user.role !== UserRole.DOCTOR ||
        user.accountStatus !== UserAccountStatus.ACTIVE ||
        user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE
      ) {
        throw new ConflictException(
          'Doctor account cannot be disabled from its current state.',
        );
      }

      const now = new Date();
      await transaction.user.update({
        where: { id: user.id },
        data: { accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED },
      });
      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await transaction.commandIdempotency.create({
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
      });

      return { disabled: true, replayed: false };
    });
  }

  async reactivate(email: string, password: string, idempotencyKey: string) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const normalizedEmail = normalizeEmail(email);

    const currentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: UserRole.DOCTOR,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (!currentUser) {
      throw new UnauthorizedException('Unable to reactivate account.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.DOCTOR_REACTIVATE_ACCOUNT;
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
          administrativeRestrictionStatus: true,
          passwordHash: true,
        },
      });

      if (!user || user.role !== UserRole.DOCTOR) {
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

      if (
        user.accountStatus !== UserAccountStatus.VOLUNTARILY_DISABLED ||
        user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE
      ) {
        throw new ConflictException(
          'Doctor account cannot be reactivated from its current state.',
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
        role: UserRole.DOCTOR,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!target) {
      throw new UnauthorizedException('Unable to permanently close account.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const commandType = CommandType.DOCTOR_DELETE_ACCOUNT;
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
          email: true,
          role: true,
          accountStatus: true,
          passwordHash: true,
        },
      });

      if (!user || user.role !== UserRole.DOCTOR) {
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
        return {
          permanentlyClosed: true,
          replayed: true,
          publicRouteRetired: true,
        };
      }

      if (
        user.accountStatus !== UserAccountStatus.ACTIVE &&
        user.accountStatus !== UserAccountStatus.VOLUNTARILY_DISABLED
      ) {
        throw new ConflictException(
          'Doctor account cannot be permanently closed from its current state.',
        );
      }

      // Milestone-2 fail-closed integration boundary:
      // Phase 4 requires financial settlement to be atomic with closure.
      // Until that settlement workflow is implemented, do not close an account
      // that already has a DoctorFinancialAccount.
      const financialRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "DoctorFinancialAccount"
        WHERE "doctorUserId" = ${user.id}
        LIMIT 1
        FOR SHARE
      `;
      if (financialRows[0]) {
        throw new ConflictException(
          'Permanent closure is unavailable while financial settlement is pending.',
        );
      }

      const startedClinicDays = await transaction.$queryRaw<
        Array<{ id: string }>
      >`
          SELECT cd."id"
          FROM "ClinicDay" cd
          INNER JOIN "PracticeLocation" pl
            ON pl."id" = cd."practiceLocationId"
          INNER JOIN "DoctorProfile" dp
            ON dp."id" = pl."doctorProfileId"
          WHERE dp."userId" = ${user.id}
            AND cd."status" = 'STARTED'
          LIMIT 1
          FOR UPDATE OF cd
        `;

      if (startedClinicDays[0]) {
        throw new ConflictException(
          'All started clinic days must be resolved before permanent account closure.',
        );
      }

      const now = new Date();
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
          closureType: AccountPermanentClosureType.DOCTOR_PERMANENT_CLOSURE,
          previousAccountStatus: user.accountStatus,
          occurredAt: now,
          commandIdempotencyId: command.id,
        },
      });

      const deliveryIdentityKey = this.hash(
        `doctor-permanent-closure|${user.id}|${command.id}`,
      );
      const message =
        'Your Doctor account has been permanently closed. Reactivation is unavailable. Your public Doctor profile and booking route are permanently retired, and previously distributed QR codes no longer provide an active Doctor booking page.';

      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey,
          notificationType: NotificationType.SECURITY_NOTIFICATION,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: null,
          commandIdempotencyId: command.id,
          recipientEmailEncrypted: this.protectedPayloadService.encrypt(
            user.email,
            'account-closure:recipient',
          ),
          recipientMobileEncrypted: null,
          messageBodyEncrypted: this.protectedPayloadService.encrypt(
            message,
            'account-closure:message',
          ),
          providerIdempotencyKey: `account-closure:${command.id}`,
          attemptCount: 0,
          nextAttemptAt: now,
          expiresAt: new Date(now.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        permanentlyClosed: true,
        replayed: false,
        publicRouteRetired: true,
      };
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
