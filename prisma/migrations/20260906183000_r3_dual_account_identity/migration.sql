-- R3 controlled account-identity revision.
-- Existing accounts remain EMAIL-primary. New accounts may be EMAIL- or MOBILE-primary.

CREATE TYPE "AccountLoginIdentifierType" AS ENUM ('EMAIL', 'MOBILE');

ALTER TYPE "OtpPurpose" ADD VALUE 'ACCOUNT_MOBILE_VERIFICATION';

ALTER TABLE "User"
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "mobileNumber" DROP NOT NULL,
  ADD COLUMN "loginIdentifierType" "AccountLoginIdentifierType" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "mobileNumberHash" VARCHAR(64),
  ADD COLUMN "mobileVerifiedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "User_mobileNumberHash_key"
  ON "User"("mobileNumberHash");

ALTER TABLE "OtpVerification"
  ADD COLUMN "userId" TEXT;

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OtpVerification_user_created_idx"
  ON "OtpVerification"("userId", "createdAt");

ALTER TABLE "SecretaryInvitation"
  ADD COLUMN "targetUserId" TEXT,
  ADD COLUMN "identifierType" "AccountLoginIdentifierType" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "normalizedIdentifier" VARCHAR(255);

UPDATE "SecretaryInvitation"
SET "normalizedIdentifier" = "normalizedEmail"
WHERE "normalizedIdentifier" IS NULL;

UPDATE "SecretaryInvitation" AS invitation
SET "targetUserId" = COALESCE(
  invitation."acceptedUserId",
  (
    SELECT "id"
    FROM "User"
    WHERE lower("email") = lower(invitation."normalizedEmail")
    ORDER BY "createdAt" ASC
    LIMIT 1
  )
)
WHERE invitation."targetUserId" IS NULL;

ALTER TABLE "SecretaryInvitation"
  ALTER COLUMN "normalizedIdentifier" SET NOT NULL,
  ALTER COLUMN "normalizedEmail" DROP NOT NULL,
  ALTER COLUMN "mobileNumber" DROP NOT NULL;

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SecretaryInvitation_targetUserId_created_idx"
  ON "SecretaryInvitation"("targetUserId", "createdAt");

ALTER TABLE "User"
  ADD CONSTRAINT "User_primary_login_identifier_check"
  CHECK (
    ("loginIdentifierType" = 'EMAIL' AND "email" IS NOT NULL)
    OR
    ("loginIdentifierType" = 'MOBILE' AND "mobileNumber" IS NOT NULL AND "mobileNumberHash" IS NOT NULL)
  );
