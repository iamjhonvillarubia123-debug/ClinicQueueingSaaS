import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  EmailVerificationStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EMAIL_PAYLOAD_PURPOSE = 'doctor-email-verification';
const DEFAULT_VERIFICATION_ISSUANCE_LIMIT_15_MINUTES = 3;
const DEFAULT_VERIFICATION_ISSUANCE_LIMIT_24_HOURS = 10;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type VerifiableUserRole = typeof UserRole.DOCTOR | typeof UserRole.SECRETARY;

export interface CreatedEmailVerification {
  id: string;
  expiresAt: Date;
}

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly protectedPayloadService: ProtectedAccountPayloadService,
  ) {}

  async createInitialVerification(
    transaction: TransactionClient,
    userId: string,
    normalizedEmail: string,
  ): Promise<CreatedEmailVerification> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.sha256(token);
    const activeVerificationKey = this.sha256(
      `${NotificationType.DOCTOR_EMAIL_VERIFICATION}:${userId}`,
    );
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VERIFICATION_LIFETIME_MS);

    const emailVerification = await transaction.emailVerification.create({
      data: {
        userId,
        tokenHash,
        activeVerificationKey,
        status: EmailVerificationStatus.PENDING,
        createdAt,
        expiresAt,
      },
    });

    const verificationUrl = this.buildVerificationUrl(token);
    const messageBody = `Verify your Clinic Queueing SaaS account: ${verificationUrl}`;
    const deliveryIdentityKey = this.sha256(
      `${NotificationType.DOCTOR_EMAIL_VERIFICATION}:${emailVerification.id}`,
    );

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: NotificationType.DOCTOR_EMAIL_VERIFICATION,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        emailVerificationId: emailVerification.id,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: this.protectedPayloadService.encrypt(
          normalizedEmail,
          `${EMAIL_PAYLOAD_PURPOSE}:recipient`,
        ),
        messageBodyEncrypted: this.protectedPayloadService.encrypt(
          messageBody,
          `${EMAIL_PAYLOAD_PURPOSE}:message`,
        ),
        providerIdempotencyKey: `account-email-verification:${emailVerification.id}`,
        nextAttemptAt: createdAt,
        expiresAt,
      },
    });

    return { id: emailVerification.id, expiresAt };
  }

  async resend(email: string): Promise<{ accepted: true }> {
    const normalizedEmail = email.trim().toLowerCase();

    const currentUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });

    if (!currentUser) {
      return { accepted: true };
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${currentUser.id}, 0))
      `;

      const user = await transaction.user.findUnique({
        where: { id: currentUser.id },
        select: {
          id: true,
          email: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          emailVerifiedAt: true,
        },
      });

      if (!user || !this.isEligibleForVerification(user)) {
        return;
      }

      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - FIFTEEN_MINUTES_MS);
      const twentyFourHoursAgo = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);
      const [recent15MinuteCount, recent24HourCount] = await Promise.all([
        transaction.emailVerification.count({
          where: { userId: user.id, createdAt: { gte: fifteenMinutesAgo } },
        }),
        transaction.emailVerification.count({
          where: { userId: user.id, createdAt: { gte: twentyFourHoursAgo } },
        }),
      ]);

      if (
        recent15MinuteCount >= this.verificationIssuanceLimit15Minutes() ||
        recent24HourCount >= this.verificationIssuanceLimit24Hours()
      ) {
        return;
      }

      const pending = await transaction.emailVerification.findFirst({
        where: {
          userId: user.id,
          status: EmailVerificationStatus.PENDING,
          activeVerificationKey: { not: null },
        },
        include: { notificationOutbox: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pending) {
        await transaction.emailVerification.update({
          where: { id: pending.id },
          data: {
            status: EmailVerificationStatus.REVOKED,
            revokedAt: now,
            tokenHash: null,
            activeVerificationKey: null,
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

      await this.createInitialVerification(transaction, user.id, user.email);
    });

    return { accepted: true };
  }

  async verify(
    token: string,
  ): Promise<{ verified: true; role: VerifiableUserRole }> {
    const tokenHash = this.sha256(token);

    const outcome = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "EmailVerification"
        WHERE "tokenHash" = ${tokenHash}
        LIMIT 1
        FOR UPDATE
      `;

      const row = rows[0];
      if (!row) return { status: 'invalid' as const };

      const verification = await transaction.emailVerification.findUnique({
        where: { id: row.id },
        include: { user: true, notificationOutbox: true },
      });

      if (
        !verification ||
        verification.status !== EmailVerificationStatus.PENDING ||
        verification.tokenHash !== tokenHash ||
        verification.activeVerificationKey === null
      ) {
        return { status: 'invalid' as const };
      }

      const now = new Date();

      if (verification.expiresAt.getTime() <= now.getTime()) {
        await transaction.emailVerification.update({
          where: { id: verification.id },
          data: {
            status: EmailVerificationStatus.EXPIRED,
            tokenHash: null,
            activeVerificationKey: null,
          },
        });

        if (
          verification.notificationOutbox?.status ===
          NotificationOutboxStatus.PENDING
        ) {
          await transaction.notificationOutbox.update({
            where: { id: verification.notificationOutbox.id },
            data: {
              status: NotificationOutboxStatus.CANCELLED,
              cancelledAt: now,
            },
          });
        }

        return { status: 'expired' as const };
      }

      if (!this.isEligibleForVerification(verification.user)) {
        return { status: 'invalid' as const };
      }

      await transaction.user.update({
        where: { id: verification.userId },
        data: { emailVerifiedAt: now },
      });

      await transaction.emailVerification.update({
        where: { id: verification.id },
        data: {
          status: EmailVerificationStatus.VERIFIED,
          verifiedAt: now,
          tokenHash: null,
          activeVerificationKey: null,
        },
      });

      if (
        verification.notificationOutbox?.status ===
        NotificationOutboxStatus.PENDING
      ) {
        await transaction.notificationOutbox.update({
          where: { id: verification.notificationOutbox.id },
          data: {
            status: NotificationOutboxStatus.CANCELLED,
            cancelledAt: now,
          },
        });
      }

      return {
        status: 'verified' as const,
        role: verification.user.role,
      };
    });

    if (outcome.status !== 'verified') {
      throw new BadRequestException('Invalid or expired verification link.');
    }

    return { verified: true, role: outcome.role };
  }

  private isEligibleForVerification(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    emailVerifiedAt: Date | null;
  }): user is typeof user & { role: VerifiableUserRole } {
    if (user.role !== UserRole.DOCTOR && user.role !== UserRole.SECRETARY) {
      return false;
    }
    if (user.accountStatus !== UserAccountStatus.ACTIVE) return false;
    if (user.emailVerifiedAt !== null) return false;
    if (
      user.role === UserRole.DOCTOR &&
      user.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      return false;
    }
    return true;
  }

  private verificationIssuanceLimit15Minutes(): number {
    return this.positiveIntegerConfig(
      'EMAIL_VERIFICATION_MAX_ISSUANCES_PER_15_MINUTES',
      DEFAULT_VERIFICATION_ISSUANCE_LIMIT_15_MINUTES,
    );
  }

  private verificationIssuanceLimit24Hours(): number {
    return this.positiveIntegerConfig(
      'EMAIL_VERIFICATION_MAX_ISSUANCES_PER_24_HOURS',
      DEFAULT_VERIFICATION_ISSUANCE_LIMIT_24_HOURS,
    );
  }

  private positiveIntegerConfig(name: string, fallback: number): number {
    const raw = this.configService.get<string>(name);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private buildVerificationUrl(token: string): string {
    const baseUrl = (
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');

    return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
