-- M10 FINANCIAL ACCESS CODE-HASH CONSTRAINT REPAIR
--
-- FinancialAccessChallenge.codeHash is a secret-verification hash, not a
-- SHA-256 lookup digest. The original foundation incorrectly required it to
-- be exactly 64 characters, while the application intentionally uses the
-- approved password/secret verification service (currently bcrypt).
--
-- Keep recoveryEmailHash fixed at the SHA-256 hex shape and require codeHash
-- to be present without coupling persistence to one secret-hash encoding.

ALTER TABLE "FinancialAccessChallenge"
  DROP CONSTRAINT "FinancialAccessChallenge_hash_shape_check";

ALTER TABLE "FinancialAccessChallenge"
  ADD CONSTRAINT "FinancialAccessChallenge_hash_shape_check"
  CHECK (
    length("recoveryEmailHash") = 64
    AND NULLIF(BTRIM("codeHash"), '') IS NOT NULL
    AND NULLIF(BTRIM("recipientEmailEncrypted"), '') IS NOT NULL
  );
