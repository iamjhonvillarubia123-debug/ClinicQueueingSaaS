import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const OTP_SECRET_RETENTION_MS = 15 * 60 * 1000;
const PROTECTED_RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
const TECHNICAL_SHELL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type SecurityRetentionCleanupResult = {
  otpSecretsCleared: number;
  otpMobileContextCleared: number;
  otpShellsDeleted: number;
  bookingRecoveryProtectedCleared: number;
  bookingGroupRecoveryProtectedCleared: number;
  bookingRecoveryShellsDeleted: number;
  bookingGroupRecoveryShellsDeleted: number;
};

@Injectable()
export class SecurityRetentionCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanupEligible(
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<SecurityRetentionCleanupResult> {
    this.assertBatchSize(batchSize);

    const otpSecretCutoff = new Date(now.getTime() - OTP_SECRET_RETENTION_MS);
    const protectedCutoff = new Date(
      now.getTime() - PROTECTED_RECOVERY_RETENTION_MS,
    );
    const shellCutoff = new Date(now.getTime() - TECHNICAL_SHELL_RETENTION_MS);

    return this.prisma.$transaction(async (transaction) => {
      const otpSecretsCleared = await transaction.$executeRaw(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "OtpVerification"
          WHERE ("otpHash" IS NOT NULL OR "otpHashKeyVersion" IS NOT NULL OR "activeContextKey" IS NOT NULL)
            AND COALESCE("consumedAt", "invalidatedAt", "expiresAt") <= ${otpSecretCutoff}
          ORDER BY COALESCE("consumedAt", "invalidatedAt", "expiresAt"), "id"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "OtpVerification" otp
        SET
          "otpHash" = NULL,
          "otpHashKeyVersion" = NULL,
          "activeContextKey" = NULL
        FROM candidates
        WHERE otp."id" = candidates."id"
      `);

      const otpMobileContextCleared = await transaction.$executeRaw(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "OtpVerification"
          WHERE ("mobileNumberHash" IS NOT NULL OR "mobileHashKeyVersion" IS NOT NULL)
            AND "createdAt" <= ${protectedCutoff}
          ORDER BY "createdAt", "id"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "OtpVerification" otp
        SET
          "mobileNumberHash" = NULL,
          "mobileHashKeyVersion" = NULL
        FROM candidates
        WHERE otp."id" = candidates."id"
      `);

      const bookingRecoveryProtectedCleared = await transaction.$executeRaw(
        Prisma.sql`
          WITH candidates AS (
            SELECT "id"
            FROM "BookingRecoveryAttempt"
            WHERE "protectedDataClearedAt" IS NULL
              AND LEAST(
                "expiresAt",
                CASE "status"
                  WHEN 'COMPLETED' THEN COALESCE("completedAt", "expiresAt")
                  WHEN 'REJECTED' THEN COALESCE("rejectedAt", "expiresAt")
                  WHEN 'EXPIRED' THEN COALESCE("expiredAt", "expiresAt")
                  WHEN 'CANCELLED' THEN COALESCE("cancelledAt", "expiresAt")
                  ELSE "expiresAt"
                END
              ) <= ${protectedCutoff}
            ORDER BY LEAST(
              "expiresAt",
              CASE "status"
                WHEN 'COMPLETED' THEN COALESCE("completedAt", "expiresAt")
                WHEN 'REJECTED' THEN COALESCE("rejectedAt", "expiresAt")
                WHEN 'EXPIRED' THEN COALESCE("expiredAt", "expiresAt")
                WHEN 'CANCELLED' THEN COALESCE("cancelledAt", "expiresAt")
                ELSE "expiresAt"
              END
            ), "id"
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "BookingRecoveryAttempt" recovery
          SET
            "mobileNumberEncrypted" = NULL,
            "mobileNumberHash" = NULL,
            "mobileHashKeyVersion" = NULL,
            "mobileNumberLastFour" = NULL,
            "candidateAppointmentId" = NULL,
            "protectedDataClearedAt" = ${now}
          FROM candidates
          WHERE recovery."id" = candidates."id"
        `,
      );

      const bookingGroupRecoveryProtectedCleared =
        await transaction.$executeRaw(Prisma.sql`
          WITH candidates AS (
            SELECT "id"
            FROM "BookingGroupRecoveryAttempt"
            WHERE "protectedDataClearedAt" IS NULL
              AND LEAST(
                "expiresAt",
                CASE "status"
                  WHEN 'COMPLETED' THEN COALESCE("completedAt", "expiresAt")
                  WHEN 'REJECTED' THEN COALESCE("rejectedAt", "expiresAt")
                  WHEN 'EXPIRED' THEN COALESCE("expiredAt", "expiresAt")
                  WHEN 'CANCELLED' THEN COALESCE("cancelledAt", "expiresAt")
                  ELSE "expiresAt"
                END
              ) <= ${protectedCutoff}
            ORDER BY LEAST(
              "expiresAt",
              CASE "status"
                WHEN 'COMPLETED' THEN COALESCE("completedAt", "expiresAt")
                WHEN 'REJECTED' THEN COALESCE("rejectedAt", "expiresAt")
                WHEN 'EXPIRED' THEN COALESCE("expiredAt", "expiresAt")
                WHEN 'CANCELLED' THEN COALESCE("cancelledAt", "expiresAt")
                ELSE "expiresAt"
              END
            ), "id"
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "BookingGroupRecoveryAttempt" recovery
          SET
            "mobileNumberEncrypted" = NULL,
            "mobileNumberHash" = NULL,
            "mobileHashKeyVersion" = NULL,
            "mobileNumberLastFour" = NULL,
            "bookingGroupId" = NULL,
            "protectedDataClearedAt" = ${now}
          FROM candidates
          WHERE recovery."id" = candidates."id"
        `);

      const otpShellsDeleted = await transaction.$executeRaw(Prisma.sql`
        WITH candidates AS (
          SELECT otp."id"
          FROM "OtpVerification" otp
          WHERE otp."createdAt" <= ${shellCutoff}
            AND otp."otpHash" IS NULL
            AND otp."activeContextKey" IS NULL
            AND otp."mobileNumberHash" IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM "NotificationOutbox" outbox
              WHERE outbox."otpVerificationId" = otp."id"
            )
          ORDER BY otp."createdAt", otp."id"
          LIMIT ${batchSize}
          FOR UPDATE OF otp SKIP LOCKED
        )
        DELETE FROM "OtpVerification" otp
        USING candidates
        WHERE otp."id" = candidates."id"
      `);

      const bookingRecoveryShellsDeleted = await transaction.$executeRaw(
        Prisma.sql`
          WITH candidates AS (
            SELECT recovery."id"
            FROM "BookingRecoveryAttempt" recovery
            WHERE recovery."protectedDataClearedAt" IS NOT NULL
              AND LEAST(
                recovery."expiresAt",
                CASE recovery."status"
                  WHEN 'COMPLETED' THEN COALESCE(recovery."completedAt", recovery."expiresAt")
                  WHEN 'REJECTED' THEN COALESCE(recovery."rejectedAt", recovery."expiresAt")
                  WHEN 'EXPIRED' THEN COALESCE(recovery."expiredAt", recovery."expiresAt")
                  WHEN 'CANCELLED' THEN COALESCE(recovery."cancelledAt", recovery."expiresAt")
                  ELSE recovery."expiresAt"
                END
              ) <= ${shellCutoff}
              AND NOT EXISTS (
                SELECT 1
                FROM "OtpVerification" otp
                WHERE otp."bookingRecoveryAttemptId" = recovery."id"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "CommandIdempotency" command
                WHERE command."bookingRecoveryAttemptId" = recovery."id"
              )
            ORDER BY LEAST(
              recovery."expiresAt",
              CASE recovery."status"
                WHEN 'COMPLETED' THEN COALESCE(recovery."completedAt", recovery."expiresAt")
                WHEN 'REJECTED' THEN COALESCE(recovery."rejectedAt", recovery."expiresAt")
                WHEN 'EXPIRED' THEN COALESCE(recovery."expiredAt", recovery."expiresAt")
                WHEN 'CANCELLED' THEN COALESCE(recovery."cancelledAt", recovery."expiresAt")
                ELSE recovery."expiresAt"
              END
            ), recovery."id"
            LIMIT ${batchSize}
            FOR UPDATE OF recovery SKIP LOCKED
          )
          DELETE FROM "BookingRecoveryAttempt" recovery
          USING candidates
          WHERE recovery."id" = candidates."id"
        `,
      );

      const bookingGroupRecoveryShellsDeleted =
        await transaction.$executeRaw(Prisma.sql`
          WITH candidates AS (
            SELECT recovery."id"
            FROM "BookingGroupRecoveryAttempt" recovery
            WHERE recovery."protectedDataClearedAt" IS NOT NULL
              AND LEAST(
                recovery."expiresAt",
                CASE recovery."status"
                  WHEN 'COMPLETED' THEN COALESCE(recovery."completedAt", recovery."expiresAt")
                  WHEN 'REJECTED' THEN COALESCE(recovery."rejectedAt", recovery."expiresAt")
                  WHEN 'EXPIRED' THEN COALESCE(recovery."expiredAt", recovery."expiresAt")
                  WHEN 'CANCELLED' THEN COALESCE(recovery."cancelledAt", recovery."expiresAt")
                  ELSE recovery."expiresAt"
                END
              ) <= ${shellCutoff}
              AND NOT EXISTS (
                SELECT 1
                FROM "OtpVerification" otp
                WHERE otp."bookingGroupRecoveryAttemptId" = recovery."id"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "CommandIdempotency" command
                WHERE command."bookingGroupRecoveryAttemptId" = recovery."id"
              )
            ORDER BY LEAST(
              recovery."expiresAt",
              CASE recovery."status"
                WHEN 'COMPLETED' THEN COALESCE(recovery."completedAt", recovery."expiresAt")
                WHEN 'REJECTED' THEN COALESCE(recovery."rejectedAt", recovery."expiresAt")
                WHEN 'EXPIRED' THEN COALESCE(recovery."expiredAt", recovery."expiresAt")
                WHEN 'CANCELLED' THEN COALESCE(recovery."cancelledAt", recovery."expiresAt")
                ELSE recovery."expiresAt"
              END
            ), recovery."id"
            LIMIT ${batchSize}
            FOR UPDATE OF recovery SKIP LOCKED
          )
          DELETE FROM "BookingGroupRecoveryAttempt" recovery
          USING candidates
          WHERE recovery."id" = candidates."id"
        `);

      return {
        otpSecretsCleared,
        otpMobileContextCleared,
        otpShellsDeleted,
        bookingRecoveryProtectedCleared,
        bookingGroupRecoveryProtectedCleared,
        bookingRecoveryShellsDeleted,
        bookingGroupRecoveryShellsDeleted,
      };
    });
  }

  private assertBatchSize(batchSize: number): void {
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Security retention cleanup batch size is invalid.',
      );
    }
  }
}
