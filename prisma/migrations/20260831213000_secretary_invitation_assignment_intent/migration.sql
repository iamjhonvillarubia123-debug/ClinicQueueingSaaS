CREATE TYPE "SecretaryInvitationAssignmentType" AS ENUM ('CLINIC_SECRETARY', 'SUBSTITUTE_SECRETARY');

ALTER TABLE "SecretaryInvitation"
  ADD COLUMN "requestedAssignmentType" "SecretaryInvitationAssignmentType",
  ADD COLUMN "requestedAuthorityBundles" "PracticeStaffAuthorityBundleType"[] NOT NULL DEFAULT ARRAY[]::"PracticeStaffAuthorityBundleType"[],
  ADD COLUMN "requestedCoverageMode" "SubstituteSecretaryCoverageMode",
  ADD COLUMN "requestedFromServiceDate" DATE,
  ADD COLUMN "requestedToServiceDate" DATE,
  ADD COLUMN "expectedCurrentPracticeStaffId" TEXT;

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_assignment_intent_check" CHECK (
    "requestedAssignmentType" IS NULL
    OR (
      "requestedAssignmentType" = 'CLINIC_SECRETARY'
      AND cardinality("requestedAuthorityBundles") > 0
      AND "requestedCoverageMode" IS NULL
      AND "requestedFromServiceDate" IS NULL
      AND "requestedToServiceDate" IS NULL
    )
    OR (
      "requestedAssignmentType" = 'SUBSTITUTE_SECRETARY'
      AND cardinality("requestedAuthorityBundles") = 0
      AND "requestedCoverageMode" IS NOT NULL
      AND "requestedFromServiceDate" IS NOT NULL
      AND "requestedToServiceDate" IS NOT NULL
      AND "requestedFromServiceDate" <= "requestedToServiceDate"
      AND (
        "requestedCoverageMode" = 'DATE_RANGE'
        OR "requestedFromServiceDate" = "requestedToServiceDate"
      )
    )
  );

CREATE INDEX "SecretaryInvitation_expected_current_staff_idx"
  ON "SecretaryInvitation"("expectedCurrentPracticeStaffId");

-- A Secretary owns one identity but may accept relationship invitations for
-- multiple clinics. The earlier onboarding model incorrectly made this global.
DROP INDEX IF EXISTS "SecretaryInvitation_acceptedUserId_key";
CREATE INDEX "SecretaryInvitation_acceptedUserId_idx"
  ON "SecretaryInvitation"("acceptedUserId");
