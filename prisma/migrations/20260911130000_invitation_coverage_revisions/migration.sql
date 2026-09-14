ALTER TABLE "SecretaryInvitation" ADD COLUMN "coverageRevisions" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "SecretaryInvitation" ADD CONSTRAINT "SecretaryInvitation_coverageRevisions_array_check" CHECK (jsonb_typeof("coverageRevisions") = 'array');
