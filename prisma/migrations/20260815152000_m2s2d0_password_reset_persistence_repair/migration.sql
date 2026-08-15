-- M2S2D0 PASSWORD RESET PERSISTENCE REPAIR
--
-- Milestone 1 created NotificationOutbox.passwordResetId and the PASSWORD_RESET
-- notification type, but omitted the approved standalone PasswordReset table and
-- foreign key. This migration restores the canonical Review-0040 persistence
-- model without changing product behavior.

CREATE TYPE "PasswordResetStatus" AS ENUM (
  'PENDING',
  'CONSUMED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "PasswordReset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64),
  "activeResetKey" VARCHAR(64),
  "status" "PasswordResetStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "consumedAt" TIMESTAMP(3) WITH TIME ZONE,
  "revokedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordReset_activeResetKey_key"
  ON "PasswordReset"("activeResetKey");

CREATE INDEX "PasswordReset_tokenHash_idx"
  ON "PasswordReset"("tokenHash");

CREATE INDEX "PasswordReset_status_expiresAt_idx"
  ON "PasswordReset"("status", "expiresAt");

CREATE INDEX "PasswordReset_userId_createdAt_idx"
  ON "PasswordReset"("userId", "createdAt");

ALTER TABLE "PasswordReset"
  ADD CONSTRAINT "PasswordReset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_passwordResetId_fkey"
  FOREIGN KEY ("passwordResetId") REFERENCES "PasswordReset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PasswordReset"
  ADD CONSTRAINT "PasswordReset_token_shape_check"
  CHECK (
    "tokenHash" IS NULL
    OR "tokenHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "PasswordReset"
  ADD CONSTRAINT "PasswordReset_active_key_shape_check"
  CHECK (
    "activeResetKey" IS NULL
    OR "activeResetKey" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "PasswordReset"
  ADD CONSTRAINT "PasswordReset_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "PasswordReset"
  ADD CONSTRAINT "PasswordReset_status_shape_check"
  CHECK (
    ("status" = 'PENDING'
      AND "tokenHash" IS NOT NULL
      AND "activeResetKey" IS NOT NULL
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL)
    OR
    ("status" = 'CONSUMED'
      AND "tokenHash" IS NULL
      AND "activeResetKey" IS NULL
      AND "consumedAt" IS NOT NULL
      AND "revokedAt" IS NULL)
    OR
    ("status" = 'REVOKED'
      AND "tokenHash" IS NULL
      AND "activeResetKey" IS NULL
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NOT NULL)
    OR
    ("status" = 'EXPIRED'
      AND "tokenHash" IS NULL
      AND "activeResetKey" IS NULL
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL)
  );
