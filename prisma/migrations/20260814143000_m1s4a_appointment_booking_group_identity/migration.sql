-- M1S4A APPOINTMENT / BOOKINGGROUP IDENTITY FOUNDATION
--
-- This migration removes the superseded permanent Patient aggregate from the
-- canonical development schema and installs Appointment-scoped temporary
-- identity plus BookingGroup shared controller context.
--
-- SAFETY: the legacy Patient/Appointment architecture cannot be transformed
-- losslessly without a reviewed data-migration mapping. Abort rather than
-- silently destroy existing development data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Patient" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "Appointment" LIMIT 1) THEN
    RAISE EXCEPTION
      'M1S4A requires an empty legacy Patient/Appointment data set. Existing rows require reviewed migration handling; no destructive conversion was performed.';
  END IF;
END $$;

ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED' AFTER 'COMPLETED';

CREATE TABLE "BookingGroup" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "controllingMobileNumberEncrypted" TEXT,
  "controllingMobileNumberHash" TEXT,
  "controllingMobileLastFour" VARCHAR(4),
  "servingProtectionEndedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BookingGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BookingGroup_practiceLocationId_serviceDate_idx"
  ON "BookingGroup"("practiceLocationId", "serviceDate");

CREATE INDEX "BookingGroup_mobile_scope_idx"
  ON "BookingGroup"("controllingMobileNumberHash", "practiceLocationId", "serviceDate");

ALTER TABLE "BookingGroup"
  ADD CONSTRAINT "BookingGroup_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingGroup"
  ADD CONSTRAINT "BookingGroup_mobile_shape_check"
  CHECK (
    (
      "controllingMobileNumberEncrypted" IS NULL
      AND "controllingMobileNumberHash" IS NULL
      AND "controllingMobileLastFour" IS NULL
    )
    OR
    (
      "controllingMobileNumberEncrypted" IS NOT NULL
      AND "controllingMobileNumberHash" IS NOT NULL
      AND "controllingMobileLastFour" IS NOT NULL
    )
  );

ALTER TABLE "Appointment"
  DROP CONSTRAINT "Appointment_patientId_fkey";

DROP INDEX "Appointment_patientId_idx";

ALTER TABLE "Appointment"
  DROP COLUMN "patientId",
  DROP COLUMN "arrivedAt",
  DROP COLUMN "serviceStartedAt";

ALTER TABLE "Appointment"
  RENAME COLUMN "serviceCompletedAt" TO "completedAt";

ALTER TABLE "Appointment"
  ALTER COLUMN "bookingReference" TYPE VARCHAR(64),
  ADD COLUMN "bookingGroupId" TEXT,
  ADD COLUMN "firstName" VARCHAR(100),
  ADD COLUMN "middleName" VARCHAR(100),
  ADD COLUMN "lastName" VARCHAR(100),
  ADD COLUMN "suffix" VARCHAR(30),
  ADD COLUMN "existingPatientResponse" "ExistingPatientResponse",
  ADD COLUMN "mobileNumberEncrypted" TEXT,
  ADD COLUMN "mobileNumberHash" TEXT,
  ADD COLUMN "mobileNumberLastFour" VARCHAR(4),
  ADD COLUMN "terminalAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "selfServiceReinsertedAt" TIMESTAMP(3) WITH TIME ZONE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_bookingGroupId_fkey"
  FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_estimatedServiceMinutes_positive_check"
  CHECK ("estimatedServiceMinutes" > 0);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_mobile_shape_check"
  CHECK (
    (
      "mobileNumberEncrypted" IS NULL
      AND "mobileNumberHash" IS NULL
      AND "mobileNumberLastFour" IS NULL
    )
    OR
    (
      "mobileNumberEncrypted" IS NOT NULL
      AND "mobileNumberHash" IS NOT NULL
      AND "mobileNumberLastFour" IS NOT NULL
    )
  );

CREATE INDEX "Appointment_bookingGroupId_idx"
  ON "Appointment"("bookingGroupId");

CREATE INDEX "Appointment_mobile_scope_status_idx"
  ON "Appointment"("mobileNumberHash", "practiceLocationId", "serviceDate", "status");

CREATE INDEX "Appointment_createdByUserId_createdAt_idx"
  ON "Appointment"("createdByUserId", "createdAt");

CREATE INDEX "Appointment_status_terminalAt_idx"
  ON "Appointment"("status", "terminalAt");

ALTER TABLE "AppointmentAnswer"
  ADD CONSTRAINT "AppointmentAnswer_single_value_check"
  CHECK (
    (CASE WHEN "answerText" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "answerNumber" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "answerBoolean" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "selectedOptionValue" IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

DROP TABLE "Patient";
