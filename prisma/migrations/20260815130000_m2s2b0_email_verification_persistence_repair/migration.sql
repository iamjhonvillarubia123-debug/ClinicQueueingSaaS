-- M2S2B0 EMAIL VERIFICATION PERSISTENCE REPAIR
--
-- Milestone 1 created NotificationOutbox.emailVerificationId and the
-- DOCTOR_EMAIL_VERIFICATION notification type, but omitted the approved
-- EmailVerification parent table and FK. This migration restores the
-- canonical Review-0042 persistence model without changing product behavior.

CREATE TYPE "EmailVerificationStatus" AS ENUM (
  'PENDING',
  'VERIFIED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "EmailVerification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64),
  "activeVerificationKey" VARCHAR(64),
  "status" "EmailVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "verifiedAt" TIMESTAMP(3) WITH TIME ZONE,
  "revokedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerification_activeVerificationKey_key"
  ON "EmailVerification"("activeVerificationKey");

CREATE INDEX "EmailVerification_tokenHash_idx"
  ON "EmailVerification"("tokenHash");

CREATE INDEX "EmailVerification_status_expiresAt_idx"
  ON "EmailVerification"("status", "expiresAt");

CREATE INDEX "EmailVerification_userId_createdAt_idx"
  ON "EmailVerification"("userId", "createdAt");

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_emailVerificationId_fkey"
  FOREIGN KEY ("emailVerificationId") REFERENCES "EmailVerification"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_token_shape_check"
  CHECK (
    "tokenHash" IS NULL
    OR "tokenHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_active_key_shape_check"
  CHECK (
    "activeVerificationKey" IS NULL
    OR "activeVerificationKey" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "EmailVerification"
  ADD CONSTRAINT "EmailVerification_status_shape_check"
  CHECK (
    ("status" = 'PENDING'
      AND "tokenHash" IS NOT NULL
      AND "activeVerificationKey" IS NOT NULL
      AND "verifiedAt" IS NULL
      AND "revokedAt" IS NULL)
    OR
    ("status" = 'VERIFIED'
      AND "tokenHash" IS NULL
      AND "activeVerificationKey" IS NULL
      AND "verifiedAt" IS NOT NULL
      AND "revokedAt" IS NULL)
    OR
    ("status" = 'REVOKED'
      AND "tokenHash" IS NULL
      AND "activeVerificationKey" IS NULL
      AND "verifiedAt" IS NULL
      AND "revokedAt" IS NOT NULL)
    OR
    ("status" = 'EXPIRED'
      AND "tokenHash" IS NULL
      AND "activeVerificationKey" IS NULL
      AND "verifiedAt" IS NULL)
  );
