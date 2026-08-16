import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const PROTECTED_DATA_RETENTION_MS = 24 * 60 * 60 * 1000;
const TECHNICAL_SHELL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type DraftIdRow = { id: string };

@Injectable()
export class BookingDraftCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async expirePendingDrafts(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
  ): Promise<number> {
    this.assertBatchSize(batchSize);

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<DraftIdRow[]>(Prisma.sql`
        SELECT "id"
        FROM "BookingDraft"
        WHERE "status" = 'PENDING_OTP'
          AND "expiresAt" <= ${now}
        ORDER BY "expiresAt", "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);

      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "OtpVerification"
        SET
          "invalidatedAt" = COALESCE("invalidatedAt", ${now}),
          "activeContextKey" = NULL,
          "otpHash" = NULL
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
          AND "consumedAt" IS NULL
      `);

      const transitioned = await transaction.$executeRaw(Prisma.sql`
        UPDATE "BookingDraft"
        SET
          "status" = 'EXPIRED',
          "expiredAt" = ${now},
          "activeDraftKey" = NULL,
          "draftControlTokenHash" = NULL
        WHERE "id" IN (${Prisma.join(ids)})
          AND "status" = 'PENDING_OTP'
          AND "expiresAt" <= ${now}
      `);

      return transitioned;
    });
  }

  async clearTerminalProtectedData(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
  ): Promise<number> {
    this.assertBatchSize(batchSize);
    const cutoff = new Date(now.getTime() - PROTECTED_DATA_RETENTION_MS);

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<DraftIdRow[]>(Prisma.sql`
        SELECT "id"
        FROM "BookingDraft"
        WHERE "protectedDataClearedAt" IS NULL
          AND (
            ("status" = 'CONSUMED' AND "consumedAt" <= ${cutoff})
            OR ("status" = 'EXPIRED' AND "expiredAt" <= ${cutoff})
            OR ("status" = 'CANCELLED' AND "cancelledAt" <= ${cutoff})
          )
        ORDER BY
          COALESCE("consumedAt", "expiredAt", "cancelledAt"),
          "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);

      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);

      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "BookingDraftAnswer"
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "BookingDraftMember"
        SET
          "firstName" = NULL,
          "middleName" = NULL,
          "lastName" = NULL,
          "suffix" = NULL,
          "existingPatientResponse" = NULL
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "OtpVerification"
        SET
          "otpHash" = NULL,
          "mobileNumberHash" = NULL,
          "activeContextKey" = NULL
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      const cleared = await transaction.$executeRaw(Prisma.sql`
        UPDATE "BookingDraft"
        SET
          "bookingReference" = NULL,
          "existingPatientResponse" = NULL,
          "firstName" = NULL,
          "middleName" = NULL,
          "lastName" = NULL,
          "suffix" = NULL,
          "mobileNumberEncrypted" = NULL,
          "mobileNumberHash" = NULL,
          "mobileNumberLastFour" = NULL,
          "activeDraftKey" = NULL,
          "draftControlTokenHash" = NULL,
          "privacyNoticeAcknowledgedAt" = NULL,
          "privacyNoticeVersion" = NULL,
          "scheduledReminderOptIn" = false,
          "protectedDataClearedAt" = ${now}
        WHERE "id" IN (${Prisma.join(ids)})
          AND "protectedDataClearedAt" IS NULL
      `);

      return cleared;
    });
  }

  async deleteEligibleTechnicalShells(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
  ): Promise<number> {
    this.assertBatchSize(batchSize);
    const cutoff = new Date(now.getTime() - TECHNICAL_SHELL_RETENTION_MS);

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<DraftIdRow[]>(Prisma.sql`
        SELECT bd."id"
        FROM "BookingDraft" bd
        WHERE bd."protectedDataClearedAt" IS NOT NULL
          AND (
            (bd."status" = 'CONSUMED' AND bd."consumedAt" <= ${cutoff})
            OR (bd."status" = 'EXPIRED' AND bd."expiredAt" <= ${cutoff})
            OR (bd."status" = 'CANCELLED' AND bd."cancelledAt" <= ${cutoff})
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "OtpVerification" otp
            WHERE otp."bookingDraftId" = bd."id"
          )
        ORDER BY
          COALESCE(bd."consumedAt", bd."expiredAt", bd."cancelledAt"),
          bd."id"
        LIMIT ${batchSize}
        FOR UPDATE OF bd SKIP LOCKED
      `);

      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);

      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "BookingDraftAnswer"
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "BookingDraftServiceSelection"
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "BookingDraftMember"
        WHERE "bookingDraftId" IN (${Prisma.join(ids)})
      `);

      return transaction.$executeRaw(Prisma.sql`
        DELETE FROM "BookingDraft"
        WHERE "id" IN (${Prisma.join(ids)})
          AND "protectedDataClearedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "OtpVerification" otp
            WHERE otp."bookingDraftId" = "BookingDraft"."id"
          )
      `);
    });
  }

  async runOnce(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
  ): Promise<{
    expired: number;
    protectedDataCleared: number;
    technicalDeleted: number;
  }> {
    const expired = await this.expirePendingDrafts(batchSize, now);
    const protectedDataCleared = await this.clearTerminalProtectedData(
      batchSize,
      now,
    );
    const technicalDeleted = await this.deleteEligibleTechnicalShells(
      batchSize,
      now,
    );

    return { expired, protectedDataCleared, technicalDeleted };
  }

  private assertBatchSize(batchSize: number): void {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new RangeError(
        'BookingDraft cleanup batch size must be 1 through 500.',
      );
    }
  }
}
