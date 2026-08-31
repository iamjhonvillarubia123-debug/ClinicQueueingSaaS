CREATE TYPE "SecretaryInvitationAssignmentType" AS ENUM ('CLINIC_SECRETARY', 'SUBSTITUTE_SECRETARY');

ALTER TABLE "SecretaryInvitation"
  ADD COLUMN "requestedAssignmentType" "SecretaryInvitationAssignmentType" NOT NULL DEFAULT 'CLINIC_SECRETARY',
  ADD COLUMN "requestedAuthorityBundles" "PracticeStaffAuthorityBundleType"[] NOT NULL DEFAULT ARRAY[]::"PracticeStaffAuthorityBundleType"[],
  ADD COLUMN "requestedCoverageMode" "SubstituteSecretaryCoverageMode",
  ADD COLUMN "requestedFromServiceDate" DATE,
  ADD COLUMN "requestedToServiceDate" DATE,
  ADD COLUMN "expectedCurrentPracticeStaffId" TEXT;
