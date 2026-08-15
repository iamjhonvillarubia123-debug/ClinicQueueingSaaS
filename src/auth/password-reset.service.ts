import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PasswordResetStatus,
  Prisma,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './security/session-security';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

const PASSWORD_RESET_LIFETIME_MS = 30 * 60 * 1000;
const PASSWORD_RESET_PAYLOAD_PURPOSE = 'password-reset';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly protectedPayloadService: ProtectedAccountPayloadService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async request(email: string): Promise<{ accepted: true }> {
    const normalizedEmail = normalizeEmail(email);
    const currentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (!currentUser) return { accepted: true };

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${currentUser.id}, 0))
      `;

      const user = await transaction.user.findUnique({
        where: { id: currentUser.id },
        select: {
          id: true,
          email: true,
          accountStatus: true,
        },
      });

      if (
        !user ||
        user.accountStatus === UserAccountStatus.PERMANENTLY_CLOSED
      ) {
        return;
      }

      const now = new Date();
      const pending = await transaction.passwordReset.findFirst({
        where: {
          userId: user.id,
          status: PasswordResetStatus.PENDING,
          activeResetKey: { not: null },
        },
        include: { notificationOutbox: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pending) {
        await transaction.passwordReset.update({
          where: { id: pending.id },
          data: {
            status: PasswordResetStatus.REVOKED,
            revokedAt: now,
            tokenHash: null,
            activeResetKey: null,
          },
        });

        if (
          pending.notificationOutbox?.status ===
          NotificationOutboxStatus.PENDING
        ) {
          await transaction.notificationOutbox.update({
            where: { id: pending.notificationOutbox.id },
            data: {
              status: NotificationOutboxStatus.CANCELLED,
              cancelledAt: now,
            },
          });
        }
      }

      await this.createReset(transaction, user.id, user.email, now);
    });

    return { accepted: true };
  }

  async consume(token: string, newPassword: string): Promise<{ reset: true }> {
    this.passwordSecurityService.assertValid(newPassword);
    const tokenHash = this.sha256(token);

    const outcome = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "PasswordReset"
        WHERE "tokenHash" = ${tokenHash}
        LIMIT 1
        FOR UPDATE
      `;

      const row = rows[0];
      if (!row) return 'invalid' as const;

      const reset = await transaction.passwordReset.findUnique({
        where: { id: row.id },
        include: { notificationOutbox: true },
      });

      if (
        !reset ||
        reset.status !== PasswordResetStatus.PENDING ||
        reset.tokenHash !== tokenHash ||
        reset.activeResetKey === null
      ) {
        return 'invalid' as const;
      }

      const now = new Date();
      if (reset.expiresAt.getTime() <= now.getTime()) {
        await this.expireReset(
          transaction,
          reset.id,
          reset.notificationOutbox?.id ?? null,
          now,
        );
        return 'expired' as const;
      }

      const userRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${reset.userId}
        LIMIT 1
        FOR UPDATE
      `;
      if (!userRows[0]) return 'invalid' as const;

      const user = await transaction.user.findUnique({
        where: { id: reset.userId },
        select: {
          id: true,
          accountStatus: true,
          emailVerifiedAt: true,
          administrativeRestrictionStatus: true,
        },
      });

      if (
        !user ||
        user.accountStatus === UserAccountStatus.PERMANENTLY_CLOSED
      ) {
        return 'invalid' as const;
      }

      const passwordHash = await this.passwordSecurityService.hash(newPassword);

      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await transaction.passwordReset.update({
        where: { id: reset.id },
        data: {
          status: PasswordResetStatus.CONSUMED,
          consumedAt: now,
          tokenHash: null,
          activeResetKey: null,
        },
      });

      await transaction.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      if (
        reset.notificationOutbox?.status === NotificationOutboxStatus.PENDING
      ) {
        await transaction.notificationOutbox.update({
          where: { id: reset.notificationOutbox.id },
          data: {
            status: NotificationOutboxStatus.CANCELLED,
            cancelledAt: now,
          },
        });
      }

      return 'reset' as const;
    });

    if (outcome !== 'reset') {
      throw new BadRequestException('Invalid or expired password reset link.');
    }

    return { reset: true };
  }

  private async createReset(
    transaction: TransactionClient,
    userId: string,
    normalizedEmail: string,
    createdAt: Date,
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.sha256(token);
    const activeResetKey = this.sha256(
      `${NotificationType.PASSWORD_RESET}:${userId}`,
    );
    const expiresAt = new Date(
      createdAt.getTime() + PASSWORD_RESET_LIFETIME_MS,
    );

    const reset = await transaction.passwordReset.create({
      data: {
        userId,
        tokenHash,
        activeResetKey,
        status: PasswordResetStatus.PENDING,
        createdAt,
        expiresAt,
      },
    });

    const resetUrl = this.buildResetUrl(token);
    const messageBody = `Reset your Clinic Queueing SaaS password: ${resetUrl}`;

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey: this.sha256(
          `${NotificationType.PASSWORD_RESET}:${reset.id}`,
        ),
        notificationType: NotificationType.PASSWORD_RESET,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        passwordResetId: reset.id,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: this.protectedPayloadService.encrypt(
          normalizedEmail,
          `${PASSWORD_RESET_PAYLOAD_PURPOSE}:recipient`,
        ),
        messageBodyEncrypted: this.protectedPayloadService.encrypt(
          messageBody,
          `${PASSWORD_RESET_PAYLOAD_PURPOSE}:message`,
        ),
        providerIdempotencyKey: `password-reset:${reset.id}`,
        nextAttemptAt: createdAt,
        expiresAt,
      },
    });
  }

  private async expireReset(
    transaction: TransactionClient,
    resetId: string,
    outboxId: string | null,
    now: Date,
  ): Promise<void> {
    await transaction.passwordReset.update({
      where: { id: resetId },
      data: {
        status: PasswordResetStatus.EXPIRED,
        tokenHash: null,
        activeResetKey: null,
      },
    });

    if (outboxId) {
      await transaction.notificationOutbox.updateMany({
        where: { id: outboxId, status: NotificationOutboxStatus.PENDING },
        data: { status: NotificationOutboxStatus.CANCELLED, cancelledAt: now },
      });
    }
  }

  private buildResetUrl(token: string): string {
    const baseUrl = (
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
