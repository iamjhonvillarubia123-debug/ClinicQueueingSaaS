-- M1S5A APPOINTMENT RECOVERY / ACCESS FOUNDATION
--
-- Adds the standalone BookingRecoveryAttempt workflow owner and reconciles
-- BookingAccessToken with short-lived protected credential cleanup.
--
-- BookingRecoveryAttempt owns public recovery scope/lifecycle.
-- BookingAccessToken remains the Appointment-scoped bearer credential.
-- Raw tokens and raw recovery mobile values are never stored by these tables.

CREATE TYPE "BookingRecoveryAttemptStatus" AS ENUM (
  'PENDING_OTP',
  'VERIFIED',
  'CANDIDATE_CONFIRMED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE "BookingRecoveryAttempt" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "mobileNumberEncrypted" TEXT,
  "mobileNumberHash" VARCHAR(64),
  "mobileHashKeyVersion" INTEGER,
  "mobileNumberLastFour" VARCHAR(4),
  "status" "BookingRecoveryAttemptStatus" NOT NULL DEFAULT 'PENDING_OTP',
  "candidateAppointmentId" TEXT,
  "verifiedAt" TIMESTAMP(3) WITH TIME ZONE,
  "candidateConfirmedAt" TIMESTAMP(3) WITH TIME ZONE,
  "completedAt" TIMESTAMP(3) WITH TIME ZONE,
  "rejectedAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiredAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "protectedDataClearedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "BookingRecoveryAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_candidateAppointmentId_fkey"
  FOREIGN KEY ("candidateAppointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_mobile_shape_check"
  CHECK (
    (
      "mobileNumberHash" IS NULL
      AND "mobileHashKeyVersion" IS NULL
    )
    OR
    (
      "mobileNumberHash" IS NOT NULL
      AND "mobileHashKeyVersion" IS NOT NULL
    )
  );

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_cleanup_shape_check"
  CHECK (
    "protectedDataClearedAt" IS NULL
    OR (
      "mobileNumberEncrypted" IS NULL
      AND "mobileNumberHash" IS NULL
      AND "mobileHashKeyVersion" IS NULL
      AND "mobileNumberLastFour" IS NULL
    )
  );

ALTER TABLE "BookingRecoveryAttempt"
  ADD CONSTRAINT "BookingRecoveryAttempt_status_shape_check"
  CHECK (
    ("status" = 'PENDING_OTP')
    OR (
      "status" = 'VERIFIED'
      AND "verifiedAt" IS NOT NULL
    )
    OR (
      "status" = 'CANDIDATE_CONFIRMED'
      AND "verifiedAt" IS NOT NULL
      AND "candidateConfirmedAt" IS NOT NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "verifiedAt" IS NOT NULL
      AND "candidateConfirmedAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "rejectedAt" IS NOT NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "expiredAt" IS NOT NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "cancelledAt" IS NOT NULL
    )
  );

CREATE INDEX "BookingRecoveryAttempt_scope_mobile_created_idx"
  ON "BookingRecoveryAttempt"("practiceLocationId", "serviceDate", "mobileNumberHash", "createdAt");

CREATE INDEX "BookingRecoveryAttempt_status_expires_idx"
  ON "BookingRecoveryAttempt"("status", "expiresAt");

CREATE INDEX "BookingRecoveryAttempt_candidate_idx"
  ON "BookingRecoveryAttempt"("candidateAppointmentId");

CREATE INDEX "BookingRecoveryAttempt_expires_idx"
  ON "BookingRecoveryAttempt"("expiresAt");

-- BookingAccessToken credential material may be cleared after revocation/
-- expiration and patient-correlating token rows must not block final
-- Appointment privacy erasure.
ALTER TABLE "BookingAccessToken"
  ALTER COLUMN "tokenHash" DROP NOT NULL;

ALTER TABLE "BookingAccessToken"
  DROP CONSTRAINT "BookingAccessToken_appointmentId_fkey";

ALTER TABLE "BookingAccessToken"
  ADD CONSTRAINT "BookingAccessToken_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingAccessToken"
  ADD CONSTRAINT "BookingAccessToken_tokenHash_nonblank_check"
  CHECK ("tokenHash" IS NULL OR NULLIF(BTRIM("tokenHash"), '') IS NOT NULL);

ALTER TABLE "BookingAccessToken"
  ADD CONSTRAINT "BookingAccessToken_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "BookingAccessToken"
  ADD CONSTRAINT "BookingAccessToken_timestamp_order_check"
  CHECK (
    ("lastUsedAt" IS NULL OR "lastUsedAt" >= "createdAt")
    AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  );

CREATE INDEX "BookingAccessToken_active_lookup_idx"
  ON "BookingAccessToken"("appointmentId", "revokedAt", "expiresAt");