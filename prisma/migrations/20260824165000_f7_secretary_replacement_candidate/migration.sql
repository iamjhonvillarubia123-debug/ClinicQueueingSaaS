-- F7 protected new-Secretary replacement candidate lifecycle.
-- Candidate onboarding creates/validates the Secretary account first.
-- Clinic authority remains with the incumbent until Doctor password-confirmed replacement.

CREATE TABLE "SecretaryReplacementInvitation" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "replacementForPracticeStaffId" TEXT NOT NULL,
    "normalizedEmail" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "mobileNumber" VARCHAR(30) NOT NULL,
    "requestedAccessProfile" "SecretaryAccessProfile" NOT NULL DEFAULT 'STANDARD',
    "requestedCanManageClinicDetails" BOOLEAN NOT NULL DEFAULT false,
    "requestedCanManageServices" BOOLEAN NOT NULL DEFAULT false,
    "requestedCanManageBookingQuestions" BOOLEAN NOT NULL DEFAULT false,
    "requestedCanManageSchedules" BOOLEAN NOT NULL DEFAULT false,
    "requestedCancelClinicDay" BOOLEAN NOT NULL DEFAULT false,
    "requestedAssignDaySecretary" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" VARCHAR(64),
    "activeInvitationKey" VARCHAR(64),
    "status" "SecretaryInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretaryReplacementInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecretaryReplacementInvitation_tokenHash_format_check"
      CHECK ("tokenHash" IS NULL OR length("tokenHash") = 64),
    CONSTRAINT "SecretaryReplacementInvitation_activeKey_format_check"
      CHECK ("activeInvitationKey" IS NULL OR length("activeInvitationKey") = 64),
    CONSTRAINT "SecretaryReplacementInvitation_status_shape_check"
      CHECK (
        ("status" = 'PENDING' AND "tokenHash" IS NOT NULL AND "activeInvitationKey" IS NOT NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NULL)
        OR ("status" = 'ACCEPTED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NOT NULL AND "acceptedUserId" IS NOT NULL AND "revokedAt" IS NULL)
        OR ("status" = 'REVOKED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NOT NULL)
        OR ("status" = 'EXPIRED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL)
      )
);

CREATE UNIQUE INDEX "SecretaryReplacementInvitation_activeInvitationKey_key"
  ON "SecretaryReplacementInvitation"("activeInvitationKey");
CREATE INDEX "SecretaryReplacementInvitation_tokenHash_idx"
  ON "SecretaryReplacementInvitation"("tokenHash");
CREATE INDEX "SecretaryReplacementInvitation_status_expires_idx"
  ON "SecretaryReplacementInvitation"("status", "expiresAt");
CREATE INDEX "SecretaryReplacementInvitation_location_created_idx"
  ON "SecretaryReplacementInvitation"("practiceLocationId", "createdAt");
CREATE INDEX "SecretaryReplacementInvitation_replaced_staff_status_idx"
  ON "SecretaryReplacementInvitation"("replacementForPracticeStaffId", "status");
CREATE INDEX "SecretaryReplacementInvitation_accepted_user_idx"
  ON "SecretaryReplacementInvitation"("acceptedUserId");

ALTER TABLE "SecretaryReplacementInvitation"
  ADD CONSTRAINT "SecretaryReplacementInvitation_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretaryReplacementInvitation"
  ADD CONSTRAINT "SecretaryReplacementInvitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretaryReplacementInvitation"
  ADD CONSTRAINT "SecretaryReplacementInvitation_acceptedUserId_fkey"
  FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SecretaryReplacementInvitation"
  ADD CONSTRAINT "SecretaryReplacementInvitation_replacementForPracticeStaffId_fkey"
  FOREIGN KEY ("replacementForPracticeStaffId") REFERENCES "PracticeStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
