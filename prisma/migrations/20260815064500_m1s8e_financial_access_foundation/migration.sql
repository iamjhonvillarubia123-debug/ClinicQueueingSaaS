-- M1S8E FINANCIAL ACCESS CHALLENGE / SESSION FOUNDATION
--
-- Establishes the separate post-closure financial-only authorization path:
--
-- FinancialAccessChallenge -> FinancialAccessSession -> DoctorFinancialAccount
--
-- This does not create, restore or substitute for UserSession.
-- Exact challenge/session lifetimes and retry/rate-limit numbers remain
-- implementation/security-policy details deferred by the approved source.
--
-- NotificationOutbox FINANCIAL_ACCESS_VERIFICATION reconciliation follows
-- after all Phase 5 financial notification source parents exist.

CREATE TABLE "FinancialAccessChallenge" (
  "id" TEXT NOT NULL,
  "recoveryEmailHash" VARCHAR(64) NOT NULL,
  "recipientEmailEncrypted" TEXT NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3) WITH TIME ZONE,
  "consumedAt" TIMESTAMP(3) WITH TIME ZONE,
  "invalidatedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinancialAccessChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinancialAccessChallenge_email_created_idx"
  ON "FinancialAccessChallenge"("recoveryEmailHash", "createdAt");

CREATE INDEX "FinancialAccessChallenge_expires_idx"
  ON "FinancialAccessChallenge"("expiresAt");

-- One non-terminal challenge per protected recovery-email identity.
-- Expired challenges must be invalidated/reconciled before a replacement is
-- created, which keeps uniqueness enforceable without using clock time inside
-- an index predicate.
CREATE UNIQUE INDEX "FinancialAccessChallenge_one_active_email_key"
  ON "FinancialAccessChallenge"("recoveryEmailHash")
  WHERE "consumedAt" IS NULL
    AND "invalidatedAt" IS NULL;

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_hash_shape_check"
  CHECK (
    length("recoveryEmailHash") = 64
    AND length("codeHash") = 64
    AND NULLIF(BTRIM("recipientEmailEncrypted"), '') IS NOT NULL
  );

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_attempt_count_check"
  CHECK ("attemptCount" >= 0);

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_timestamp_order_check"
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

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_terminal_exclusivity_check"
  CHECK (
    NOT (
      "consumedAt" IS NOT NULL
      AND "invalidatedAt" IS NOT NULL
    )
  );

CREATE TABLE "FinancialAccessSession" (
  "id" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "sourceChallengeId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "revokedAt" TIMESTAMP(3) WITH TIME ZONE,
  "lastUsedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinancialAccessSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialAccessSession_tokenHash_key"
  ON "FinancialAccessSession"("tokenHash");

CREATE INDEX "FinancialAccessSession_financialAccount_expires_idx"
  ON "FinancialAccessSession"("doctorFinancialAccountId", "expiresAt");

CREATE UNIQUE INDEX "FinancialAccessSession_sourceChallengeId_key"
  ON "FinancialAccessSession"("sourceChallengeId");

CREATE INDEX "FinancialAccessSession_expires_idx"
  ON "FinancialAccessSession"("expiresAt");

ALTER TABLE "FinancialAccessSession"
  ADD CONSTRAINT "FinancialAccessSession_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialAccessSession"
  ADD CONSTRAINT "FinancialAccessSession_sourceChallengeId_fkey"
  FOREIGN KEY ("sourceChallengeId") REFERENCES "FinancialAccessChallenge"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialAccessSession"
  ADD CONSTRAINT "FinancialAccessSession_token_hash_check"
  CHECK (length("tokenHash") = 64);

ALTER TABLE "FinancialAccessSession"
  ADD CONSTRAINT "FinancialAccessSession_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "FinancialAccessSession"
  ADD CONSTRAINT "FinancialAccessSession_timestamp_order_check"
  CHECK (
    ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
    AND ("lastUsedAt" IS NULL OR "lastUsedAt" >= "createdAt")
  );