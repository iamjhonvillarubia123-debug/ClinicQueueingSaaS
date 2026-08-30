CREATE TYPE "SecretaryAccessProfile" AS ENUM ('STANDARD', 'FULL_CLINIC_CONFIGURATION', 'CUSTOM');

ALTER TYPE "PracticeStaffCapabilityType" ADD VALUE IF NOT EXISTS 'ASSIGN_DAY_SECRETARY';

ALTER TABLE "PracticeStaff"
  ADD COLUMN "accessProfile" "SecretaryAccessProfile" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "canManageClinicDetails" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageServices" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageBookingQuestions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageSchedules" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SecretaryInvitation"
  ADD COLUMN "requestedAccessProfile" "SecretaryAccessProfile" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "requestedCanManageClinicDetails" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedCanManageServices" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedCanManageBookingQuestions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedCanManageSchedules" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedCancelClinicDay" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedAssignDaySecretary" BOOLEAN NOT NULL DEFAULT false;
