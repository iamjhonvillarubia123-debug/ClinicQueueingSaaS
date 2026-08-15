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
    const messageBody = `Verify your Clinic Queueing SaaS Doctor account: ${verificationUrl}`;
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
        providerIdempotencyKey: `doctor-email-verification:${emailVerification.id}`,
        nextAttemptAt: createdAt,
        expiresAt,
      },
    });

    return { id: emailVerification.id, expiresAt };
  }

  async verify(token: string): Promise<{ verified: true }> {
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
      if (!row) return 'invalid' as const;

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
        return 'invalid' as const;
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

        return 'expired' as const;
      }

      if (
        verification.user.role !== UserRole.DOCTOR ||
        verification.user.accountStatus !== UserAccountStatus.ACTIVE ||
        verification.user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE ||
        verification.user.emailVerifiedAt !== null
      ) {
        return 'invalid' as const;
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

      return 'verified' as const;
    });

    if (outcome !== 'verified') {
      throw new BadRequestException('Invalid or expired verification link.');
    }

    return { verified: true };
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
