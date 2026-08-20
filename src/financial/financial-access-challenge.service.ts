import { createHash, randomInt } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL_PURPOSE = 'financial-access:recipient-email';

@Injectable()
export class FinancialAccessChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurity: PasswordSecurityService,
    private readonly protectedPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async request(rawEmail: string, now = new Date()) {
    const email = this.normalizeEmail(rawEmail);
    const recoveryEmailHash = this.sha256(email);

    await this.prisma.$transaction(async (transaction) => {
      const eligible = await transaction.doctorFinancialAccount.findFirst({
        where: {
          recoveryEmailHash,
          doctorUser: { accountStatus: UserAccountStatus.PERMANENTLY_CLOSED },
        },
        select: { id: true },
      });

      await transaction.financialAccessChallenge.updateMany({
        where: {
          recoveryEmailHash,
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });

      if (!eligible) return;

      const rawCode = randomInt(100000, 1000000).toString();
      const codeHash = await this.passwordSecurity.hash(rawCode);
      const recipientEmailEncrypted = this.protectedPayload.encrypt(
        email,
        RECIPIENT_EMAIL_PURPOSE,
      );
      const challenge = await transaction.financialAccessChallenge.create({
        data: {
          recoveryEmailHash,
          recipientEmailEncrypted,
          codeHash,
          expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
          createdAt: now,
        },
        select: { id: true },
      });

      const deliveryIdentityKey = this.sha256(
        `${NotificationType.FINANCIAL_ACCESS_VERIFICATION}|${challenge.id}`,
      );
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey,
          notificationType: NotificationType.FINANCIAL_ACCESS_VERIFICATION,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: null,
          financialAccessChallengeId: challenge.id,
          recipientMobileEncrypted: null,
          recipientEmailEncrypted,
          messageBodyEncrypted: this.notificationPayload.encryptMessage(
            `Your financial access verification code is ${rawCode}.`,
          ),
          providerIdempotencyKey: `financial-access:${deliveryIdentityKey}`,
          attemptCount: 0,
          nextAttemptAt: now,
          expiresAt: new Date(now.getTime() + OUTBOX_RETENTION_MS),
          createdAt: now,
        },
      });
    });

    return { accepted: true };
  }

  async verify(challengeId: string, rawCode: string, now = new Date()) {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          codeHash: string;
          expiresAt: Date;
          attemptCount: number;
          verifiedAt: Date | null;
          consumedAt: Date | null;
          invalidatedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "codeHash",
          "expiresAt",
          "attemptCount",
          "verifiedAt",
          "consumedAt",
          "invalidatedAt"
        FROM "FinancialAccessChallenge"
        WHERE "id" = ${challengeId}
        FOR UPDATE
      `);
      const challenge = rows[0];
      if (
        !challenge ||
        challenge.expiresAt.getTime() <= now.getTime() ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        challenge.attemptCount >= MAX_ATTEMPTS
      ) {
        throw new UnauthorizedException(
          'Financial access verification failed.',
        );
      }
      if (challenge.verifiedAt) {
        return { challengeId: challenge.id, verifiedAt: challenge.verifiedAt };
      }

      const matches = await this.passwordSecurity.verify(
        rawCode,
        challenge.codeHash,
      );
      if (!matches) {
        const nextAttemptCount = challenge.attemptCount + 1;
        await transaction.financialAccessChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount: nextAttemptCount,
            invalidatedAt: nextAttemptCount >= MAX_ATTEMPTS ? now : null,
          },
        });
        throw new UnauthorizedException(
          'Financial access verification failed.',
        );
      }

      const verified = await transaction.financialAccessChallenge.update({
        where: { id: challenge.id },
        data: { verifiedAt: now },
        select: { id: true, verifiedAt: true },
      });
      return { challengeId: verified.id, verifiedAt: verified.verifiedAt };
    });
  }

  private normalizeEmail(rawEmail: string): string {
    return rawEmail.trim().toLowerCase();
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
