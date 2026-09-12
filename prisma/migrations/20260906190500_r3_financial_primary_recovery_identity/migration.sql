-- R3 dual-identity financial recovery compatibility migration.
-- Existing email recovery data remains available while generic primary-identity
-- fields support both verified email and verified mobile recovery channels.

ALTER TABLE "DoctorFinancialAccount"
  ADD COLUMN "recoveryIdentifierType" "AccountLoginIdentifierType",
  ADD COLUMN "recoveryIdentifierEncrypted" TEXT,
  ADD COLUMN "recoveryIdentifierHash" VARCHAR(128);

UPDATE "DoctorFinancialAccount"
SET
  "recoveryIdentifierType" = 'EMAIL',
  "recoveryIdentifierEncrypted" = "recoveryEmailEncrypted",
  "recoveryIdentifierHash" = "recoveryEmailHash"
WHERE "recoveryEmailHash" IS NOT NULL
  AND "recoveryIdentifierHash" IS NULL;

CREATE INDEX "DoctorFinancialAccount_recoveryIdentifier_idx"
  ON "DoctorFinancialAccount"("recoveryIdentifierType", "recoveryIdentifierHash");

ALTER TABLE "FinancialAccessChallenge"
  ADD COLUMN "recoveryIdentifierType" "AccountLoginIdentifierType",
  ADD COLUMN "recoveryIdentifierHash" VARCHAR(128),
  ADD COLUMN "recipientIdentifierEncrypted" TEXT;

UPDATE "FinancialAccessChallenge"
SET
  "recoveryIdentifierType" = 'EMAIL',
  "recoveryIdentifierHash" = "recoveryEmailHash",
  "recipientIdentifierEncrypted" = "recipientEmailEncrypted"
WHERE "recoveryIdentifierHash" IS NULL;

ALTER TABLE "FinancialAccessChallenge"
  ALTER COLUMN "recoveryEmailHash" DROP NOT NULL,
  ALTER COLUMN "recipientEmailEncrypted" DROP NOT NULL;

CREATE INDEX "FinancialAccessChallenge_identifier_created_idx"
  ON "FinancialAccessChallenge"("recoveryIdentifierType", "recoveryIdentifierHash", "createdAt");
