ALTER TABLE "SecretaryInvitation" ADD COLUMN "requestedCoverageRanges" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "SecretaryInvitation" ADD CONSTRAINT "SecretaryInvitation_requestedCoverageRanges_array_check" CHECK (jsonb_typeof("requestedCoverageRanges") = 'array');
