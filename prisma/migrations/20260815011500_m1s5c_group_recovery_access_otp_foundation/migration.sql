-- M1S5C GROUP RECOVERY / ACCESS / OTP FOUNDATION
--
-- Adds distinct BookingGroupAccessToken and BookingGroupRecoveryAttempt models
-- and extends centralized OtpVerification to the third approved purpose/parent:
-- BOOKING_GROUP_RECOVERY -> BookingGroupRecoveryAttempt.

CREATE TYPE "BookingGroupAccessTokenPurpose" AS ENUM ('CONTROLLER_ACCESS');

CREATE TYPE "BookingGroupRecoveryAttemptStatus" AS ENUM (
  'PENDING_OTP',
  'VERIFIED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE "BookingGroupAccessToken" (
  "id" TEXT NOT NULL,
  "bookingGroupId" TEXT NOT NULL,
  "tokenHash" VARCHAR(255),
  "purpose" "BookingGroupAccessTokenPurpose" NOT NULL DEFAULT 'CONTROLLER_ACCESS',
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "lastUsedAt" TIMESTAMP(3) WITH TIME ZONE,
  "revokedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingGroupAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingGroupAccessToken_tokenHash_key"
  ON "BookingGroupAccessToken"("tokenHash");
CREATE INDEX "BookingGroupAccessToken_group_idx"
  ON "BookingGroupAccessToken"("bookingGroupId");
CREATE INDEX "BookingGroupAccessToken_expires_idx"
  ON "BookingGroupAccessToken"("expiresAt");
CREATE INDEX "BookingGroupAccessToken_active_lookup_idx"
  ON "BookingGroupAccessToken"("bookingGroupId", "revokedAt", "expiresAt");

ALTER TABLE "BookingGroupAccessToken"
  ADD CONSTRAINT "BookingGroupAccessToken_bookingGroupId_fkey"
  FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingGroupAccessToken"
  ADD CONSTRAINT "BookingGroupAccessToken_tokenHash_nonblank_check"
  CHECK ("tokenHash" IS NULL OR NULLIF(BTRIM("tokenHash"), '') IS NOT NULL);

ALTER TABLE "BookingGroupAccessToken"
  ADD CONSTRAINT "BookingGroupAccessToken_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "BookingGroupAccessToken"
  ADD CONSTRAINT "BookingGroupAccessToken_timestamp_order_check"
  CHECK (
    ("lastUsedAt" IS NULL OR "lastUsedAt" >= "createdAt")
    AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  );

CREATE TABLE "BookingGroupRecoveryAttempt" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "mobileNumberEncrypted" TEXT,
  "mobileNumberHash" VARCHAR(64),
  "mobileHashKeyVersion" INTEGER,
  "mobileNumberLastFour" VARCHAR(4),
  "bookingGroupId" TEXT,
  "status" "BookingGroupRecoveryAttemptStatus" NOT NULL DEFAULT 'PENDING_OTP',
  "verifiedAt" TIMESTAMP(3) WITH TIME ZONE,
  "completedAt" TIMESTAMP(3) WITH TIME ZONE,
  "rejectedAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiredAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "protectedDataClearedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  CONSTRAINT "BookingGroupRecoveryAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_bookingGroupId_fkey"
  FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_mobile_shape_check"
  CHECK (
    ("mobileNumberHash" IS NULL AND "mobileHashKeyVersion" IS NULL)
    OR
    ("mobileNumberHash" IS NOT NULL AND "mobileHashKeyVersion" IS NOT NULL)
  );

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_cleanup_shape_check"
  CHECK (
    "protectedDataClearedAt" IS NULL
    OR (
      "mobileNumberEncrypted" IS NULL
      AND "mobileNumberHash" IS NULL
      AND "mobileHashKeyVersion" IS NULL
      AND "mobileNumberLastFour" IS NULL
    )
  );

ALTER TABLE "BookingGroupRecoveryAttempt"
  ADD CONSTRAINT "BookingGroupRecoveryAttempt_status_shape_check"
  CHECK (
    ("status" = 'PENDING_OTP')
    OR ("status" = 'VERIFIED' AND "verifiedAt" IS NOT NULL)
    OR ("status" = 'COMPLETED' AND "verifiedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "rejectedAt" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  );

CREATE INDEX "BookingGroupRecoveryAttempt_scope_mobile_created_idx"
  ON "BookingGroupRecoveryAttempt"("practiceLocationId", "serviceDate", "mobileNumberHash", "createdAt");
CREATE INDEX "BookingGroupRecoveryAttempt_status_expires_idx"
  ON "BookingGroupRecoveryAttempt"("status", "expiresAt");
CREATE INDEX "BookingGroupRecoveryAttempt_group_idx"
  ON "BookingGroupRecoveryAttempt"("bookingGroupId");
CREATE INDEX "BookingGroupRecoveryAttempt_expires_idx"
  ON "BookingGroupRecoveryAttempt"("expiresAt");

ALTER TABLE "OtpVerification"
  DROP CONSTRAINT "OtpVerification_purpose_parent_check";

ALTER TYPE "OtpPurpose" RENAME TO "OtpPurpose_old";

CREATE TYPE "OtpPurpose" AS ENUM (
  'BOOKING',
  'APPOINTMENT_RECOVERY',
  'BOOKING_GROUP_RECOVERY'
);

ALTER TABLE "OtpVerification"
  ALTER COLUMN "purpose" TYPE "OtpPurpose"
  USING ("purpose"::text)::"OtpPurpose";

DROP TYPE "OtpPurpose_old";

ALTER TABLE "OtpVerification"
  ADD COLUMN "bookingGroupRecoveryAttemptId" TEXT;

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_bookingGroupRecoveryAttemptId_fkey"
  FOREIGN KEY ("bookingGroupRecoveryAttemptId") REFERENCES "BookingGroupRecoveryAttempt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_purpose_parent_check"
  CHECK (
    (
      "purpose" = 'BOOKING'
      AND "bookingDraftId" IS NOT NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
    )
    OR
    (
      "purpose" = 'APPOINTMENT_RECOVERY'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NOT NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
    )
    OR
    (
      "purpose" = 'BOOKING_GROUP_RECOVERY'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NOT NULL
    )
  );

CREATE INDEX "OtpVerification_group_recovery_created_idx"
  ON "OtpVerification"("bookingGroupRecoveryAttemptId", "createdAt");