-- F7 Secretary onboarding reconciliation.
-- Implements the approved invitation-only new Secretary lifecycle.

CREATE TYPE "SecretaryInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "SecretaryInvitation" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "normalizedEmail" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "mobileNumber" VARCHAR(30) NOT NULL,
    "tokenHash" VARCHAR(64),
    "activeInvitationKey" VARCHAR(64),
    "status" "SecretaryInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretaryInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecretaryInvitation_tokenHash_format_check"
      CHECK ("tokenHash" IS NULL OR length("tokenHash") = 64),
    CONSTRAINT "SecretaryInvitation_activeInvitationKey_format_check"
      CHECK ("activeInvitationKey" IS NULL OR length("activeInvitationKey") = 64),
    CONSTRAINT "SecretaryInvitation_status_shape_check"
      CHECK (
        ("status" = 'PENDING' AND "tokenHash" IS NOT NULL AND "activeInvitationKey" IS NOT NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NULL)
        OR ("status" = 'ACCEPTED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NOT NULL AND "acceptedUserId" IS NOT NULL AND "revokedAt" IS NULL)
        OR ("status" = 'REVOKED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NOT NULL)
        OR ("status" = 'EXPIRED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL)
      )
);

CREATE UNIQUE INDEX "SecretaryInvitation_activeInvitationKey_key" ON "SecretaryInvitation"("activeInvitationKey");
CREATE UNIQUE INDEX "SecretaryInvitation_acceptedUserId_key" ON "SecretaryInvitation"("acceptedUserId");
CREATE INDEX "SecretaryInvitation_tokenHash_idx" ON "SecretaryInvitation"("tokenHash");
CREATE INDEX "SecretaryInvitation_status_expires_idx" ON "SecretaryInvitation"("status", "expiresAt");
CREATE INDEX "SecretaryInvitation_location_created_idx" ON "SecretaryInvitation"("practiceLocationId", "createdAt");
CREATE INDEX "SecretaryInvitation_invitedBy_created_idx" ON "SecretaryInvitation"("invitedByUserId", "createdAt");

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_acceptedUserId_fkey"
  FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The scalar existed in the canonical Prisma surface before its source table
-- was reconciled. Add it only when an older database does not yet contain it.
ALTER TABLE "NotificationOutbox"
  ADD COLUMN IF NOT EXISTS "secretaryInvitationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_secretaryInvitationId_key"
  ON "NotificationOutbox"("secretaryInvitationId");

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_secretaryInvitationId_fkey"
  FOREIGN KEY ("secretaryInvitationId") REFERENCES "SecretaryInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
