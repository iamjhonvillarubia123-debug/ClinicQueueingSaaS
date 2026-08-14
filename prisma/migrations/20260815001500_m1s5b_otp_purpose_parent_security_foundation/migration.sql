-- M1S5B OTP PURPOSE / PARENT / SECURITY-STATE FOUNDATION
--
-- Reconciles OtpVerification to the approved centralized OTP security model
-- for BOOKING and APPOINTMENT_RECOVERY. Group recovery is added in M1S5C
-- together with its authoritative parent model.
--
-- Raw OTP is never stored. Protected OTP/mobile hashes are nullable so the
-- approved 15-minute / 24-hour cleanup can destroy them while a minimized
-- seven-day technical shell remains.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OtpVerification"
    WHERE length("otpHash") > 64
       OR length("mobileNumberHash") > 64
  ) THEN
    RAISE EXCEPTION
      'M1S5B cannot safely narrow existing OTP/mobile hashes to 64 characters. Review existing OtpVerification rows before migration.';
  END IF;
END $$;

ALTER TYPE "OtpPurpose" RENAME TO "OtpPurpose_old";

CREATE TYPE "OtpPurpose" AS ENUM (
  'BOOKING',
  'APPOINTMENT_RECOVERY'
);

ALTER TABLE "OtpVerification"
  ALTER COLUMN "purpose" TYPE "OtpPurpose"
  USING (
    CASE
      WHEN "purpose"::text = 'BOOKING_VERIFICATION' THEN 'BOOKING'
      ELSE "purpose"::text
    END
  )::"OtpPurpose";

DROP TYPE "OtpPurpose_old";

ALTER TABLE "OtpVerification"
  ALTER COLUMN "bookingDraftId" DROP NOT NULL,
  ALTER COLUMN "mobileNumberHash" TYPE VARCHAR(64),
  ALTER COLUMN "mobileNumberHash" DROP NOT NULL,
  ALTER COLUMN "otpHash" TYPE VARCHAR(64),
  ALTER COLUMN "otpHash" DROP NOT NULL,
  DROP COLUMN "maxAttempts",
  ADD COLUMN "bookingRecoveryAttemptId" TEXT,
  ADD COLUMN "mobileHashKeyVersion" INTEGER,
  ADD COLUMN "otpHashKeyVersion" INTEGER,
  ADD COLUMN "activeContextKey" VARCHAR(100),
  ADD COLUMN "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "OtpVerification"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_bookingRecoveryAttemptId_fkey"
  FOREIGN KEY ("bookingRecoveryAttemptId") REFERENCES "BookingRecoveryAttempt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_purpose_parent_check"
  CHECK (
    (
      "purpose" = 'BOOKING'
      AND "bookingDraftId" IS NOT NULL
      AND "bookingRecoveryAttemptId" IS NULL
    )
    OR
    (
      "purpose" = 'APPOINTMENT_RECOVERY'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NOT NULL
    )
  );

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_attempt_count_check"
  CHECK ("attemptCount" >= 0 AND "attemptCount" <= 5);

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_hash_shape_check"
  CHECK (
    ("otpHash" IS NULL OR length("otpHash") = 64)
    AND ("mobileNumberHash" IS NULL OR length("mobileNumberHash") = 64)
    AND ("otpHashKeyVersion" IS NULL OR "otpHashKeyVersion" > 0)
    AND ("mobileHashKeyVersion" IS NULL OR "mobileHashKeyVersion" > 0)
    AND ("activeContextKey" IS NULL OR NULLIF(BTRIM("activeContextKey"), '') IS NOT NULL)
  );

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_timestamp_order_check"
  CHECK (
    ("verifiedAt" IS NULL OR "verifiedAt" >= "createdAt")
    AND (
      "consumedAt" IS NULL
      OR (
        "verifiedAt" IS NOT NULL
        AND "consumedAt" >= "verifiedAt"
      )
    )
    AND ("invalidatedAt" IS NULL OR "invalidatedAt" >= "createdAt")
  );

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_terminal_exclusivity_check"
  CHECK (
    NOT (
      "consumedAt" IS NOT NULL
      AND "invalidatedAt" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "OtpVerification_activeContextKey_key"
  ON "OtpVerification"("activeContextKey");

DROP INDEX IF EXISTS "OtpVerification_bookingDraftId_idx";
DROP INDEX IF EXISTS "OtpVerification_mobileNumberHash_purpose_expiresAt_idx";
DROP INDEX IF EXISTS "OtpVerification_expiresAt_idx";

CREATE INDEX "OtpVerification_bookingDraft_created_idx"
  ON "OtpVerification"("bookingDraftId", "createdAt");

CREATE INDEX "OtpVerification_recovery_created_idx"
  ON "OtpVerification"("bookingRecoveryAttemptId", "createdAt");

CREATE INDEX "OtpVerification_mobile_created_idx"
  ON "OtpVerification"("mobileNumberHash", "createdAt");

CREATE INDEX "OtpVerification_expires_idx"
  ON "OtpVerification"("expiresAt");