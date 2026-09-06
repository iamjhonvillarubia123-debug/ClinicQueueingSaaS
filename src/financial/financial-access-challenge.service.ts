import { createHash, randomInt, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { parseAccountIdentifier } from '../auth/security/account-identifier';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL_PURPOSE = 'financial-access:recipient-email';
const RECIPIENT_IDENTIFIER_PURPOSE = 'financial-access:recipient-identifier';

@Injectable()
export class FinancialAccessChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurity: PasswordSecurityService,
    private readonly protectedPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
    private readonly mobileNumberService: MobileNumberService,
  ) {}

  async request(rawIdentifier: string, now = new Date()) {
    const identifier = parseAccountIdentifier(
      rawIdentifier,
      this.mobileNumberService,
    );
    const recoveryIdentifierHash =
      identifier.type === 'EMAIL'
        ? this.sha256(identifier.normalized)
        : identifier.mobileHash;

    await this.prisma.$transaction(async (transaction) => {
      const eligibleRows = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT dfa."id"
          FROM "DoctorFinancialAccount" dfa
          INNER JOIN "User" u ON u."id" = dfa."doctorUserId"
          WHERE dfa."recoveryIdentifierType" = CAST(${identifier.type} AS "LoginIdentifierType")
            AND dfa."recoveryIdentifierHash" = ${recoveryIdentifierHash}
            AND u."accountStatus" = 'PERMANENTLY_CLOSED'
          LIMIT 1
        `,
      );

      await transaction.$executeRaw(
        Prisma.sql`
          UPDATE "FinancialAccessChallenge"
          SET "invalidatedAt" = ${now}
          WHERE "recoveryIdentifierType" = CAST(${identifier.type} AS "LoginIdentifierType")
            AND "recoveryIdentifierHash" = ${recoveryIdentifierHash}
            AND "verifiedAt" IS NULL
            AND "consumedAt" IS NULL
            AND "invalidatedAt" IS NULL
        `,
      );

      if (!eligibleRows[0]) return;

      const rawCode = randomInt(100000, 1000000).toString();
      const codeHash = await this.passwordSecurity.hash(rawCode);
      const challengeId = randomUUID();
      const recipientIdentifierEncrypted = this.protectedPayload.encrypt(
        identifier.normalized,
        `${RECIPIENT_IDENTIFIER_PURPOSE}:${identifier.type.toLowerCase()}`,
      );
      const legacyRecipientEmailEncrypted =
        identifier.type === 'EMAIL'
          ? this.protectedPayload.encrypt(
              identifier.normalized,
              RECIPIENT_EMAIL_PURPOSE,
            )
          : null;
      const legacyRecoveryEmailHash =
        identifier.type === 'EMAIL'
          ? this.sha256(identifier.normalized)
          : null;
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

      await transaction.$executeRaw(
        Prisma.sql`
          INSERT INTO "FinancialAccessChallenge" (
            "id",
            "recoveryEmailHash",
            "recipientEmailEncrypted",
            "recoveryIdentifierType",
            "recoveryIdentifierHash",
            "recipientIdentifierEncrypted",
            "codeHash",
            "expiresAt",
            "attemptCount",
            "createdAt"
          ) VALUES (
            ${challengeId},
            ${legacyRecoveryEmailHash},
            ${legacyRecipientEmailEncrypted},
            CAST(${identifier.type} AS "LoginIdentifierType"),
            ${recoveryIdentifierHash},
            ${recipientIdentifierEncrypted},
            ${codeHash},
            ${expiresAt},
            0,
            ${now}
          )
        `,
      );

      const deliveryIdentityKey = this.sha256(
        `${NotificationType.FINANCIAL_ACCESS_VERIFICATION}|${challengeId}`,
      );
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey,
          notificationType: NotificationType.FINANCIAL_ACCESS_VERIFICATION,
          channel:
            identifier.type === 'EMAIL'
              ? NotificationChannel.EMAIL
              : NotificationChannel.SMS,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: null,
          financialAccessChallengeId: challengeId,
          recipientMobileEncrypted:
            identifier.type === 'MOBILE'
              ? this.mobileNumberService.encrypt(identifier.normalized)
              : null,
          recipientEmailEncrypted: legacyRecipientEmailEncrypted,
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

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
