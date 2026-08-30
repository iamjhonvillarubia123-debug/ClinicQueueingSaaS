-- F5 substitute coverage command scope/result references.

ALTER TABLE "CommandIdempotency"
  ADD COLUMN "substituteSecretaryCoverageId" TEXT,
  ADD COLUMN "resultSubstituteSecretaryCoverageId" TEXT;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_substituteSecretaryCoverageId_fkey"
    FOREIGN KEY ("substituteSecretaryCoverageId")
    REFERENCES "SubstituteSecretaryCoverage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CommandIdempotency_resultSubstituteSecretaryCoverageId_fkey"
    FOREIGN KEY ("resultSubstituteSecretaryCoverageId")
    REFERENCES "SubstituteSecretaryCoverage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CommandIdempotency_substituteCoverage_idx"
  ON "CommandIdempotency" ("substituteSecretaryCoverageId");

CREATE INDEX "CommandIdempotency_resultSubstituteCoverage_idx"
  ON "CommandIdempotency" ("resultSubstituteSecretaryCoverageId");
