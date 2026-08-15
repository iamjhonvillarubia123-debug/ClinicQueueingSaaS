-- M2S2F1 SECRETARY DISABLE LIFECYCLE PERSISTENCE REPAIR
--
-- Installs the approved ClinicDay operating-staff handoff audit model that
-- Milestone 1 omitted. Secretary self-disable uses the approved lifecycle
-- attribution exception: actorUserId identifies the departing authenticated
-- Secretary only for automatic lifecycle cleanup. Normal handoff commands
-- continue to require the owning Doctor as actor.

CREATE TYPE "ClinicDayOperatingStaffChangeType" AS ENUM (
  'ASSIGNED',
  'REPLACED',
  'CLEARED'
);

CREATE TABLE "ClinicDayOperatingStaffAudit" (
  "id" TEXT NOT NULL,
  "clinicDayId" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "changeType" "ClinicDayOperatingStaffChangeType" NOT NULL,
  "previousOperatingPracticeStaffId" TEXT,
  "newOperatingPracticeStaffId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicDayOperatingStaffAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClinicDayOperatingStaffAudit_clinicDayId_createdAt_idx"
  ON "ClinicDayOperatingStaffAudit"("clinicDayId", "createdAt");
CREATE INDEX "ClinicDayOperatingStaffAudit_practiceLocationId_serviceDate_createdAt_idx"
  ON "ClinicDayOperatingStaffAudit"("practiceLocationId", "serviceDate", "createdAt");
CREATE INDEX "ClinicDayOperatingStaffAudit_actorUserId_createdAt_idx"
  ON "ClinicDayOperatingStaffAudit"("actorUserId", "createdAt");
CREATE INDEX "ClinicDayOperatingStaffAudit_previousOperatingPracticeStaffId_createdAt_idx"
  ON "ClinicDayOperatingStaffAudit"("previousOperatingPracticeStaffId", "createdAt");
CREATE INDEX "ClinicDayOperatingStaffAudit_newOperatingPracticeStaffId_createdAt_idx"
  ON "ClinicDayOperatingStaffAudit"("newOperatingPracticeStaffId", "createdAt");

ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_clinicDayId_fkey"
  FOREIGN KEY ("clinicDayId") REFERENCES "ClinicDay"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_previousOperatingPracticeStaffId_fkey"
  FOREIGN KEY ("previousOperatingPracticeStaffId") REFERENCES "PracticeStaff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_newOperatingPracticeStaffId_fkey"
  FOREIGN KEY ("newOperatingPracticeStaffId") REFERENCES "PracticeStaff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicDayOperatingStaffAudit"
  ADD CONSTRAINT "ClinicDayOperatingStaffAudit_change_shape_check"
  CHECK (
    ("changeType" = 'ASSIGNED'
      AND "previousOperatingPracticeStaffId" IS NULL
      AND "newOperatingPracticeStaffId" IS NOT NULL)
    OR
    ("changeType" = 'REPLACED'
      AND "previousOperatingPracticeStaffId" IS NOT NULL
      AND "newOperatingPracticeStaffId" IS NOT NULL
      AND "previousOperatingPracticeStaffId" <> "newOperatingPracticeStaffId")
    OR
    ("changeType" = 'CLEARED'
      AND "previousOperatingPracticeStaffId" IS NOT NULL
      AND "newOperatingPracticeStaffId" IS NULL)
  );
