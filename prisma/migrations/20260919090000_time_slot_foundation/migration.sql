CREATE TYPE "AppointmentMode" AS ENUM ('QUEUE_MODE', 'TIME_SLOT_MODE');

ALTER TABLE "Appointment" ADD COLUMN     "appointmentMode" "AppointmentMode" NOT NULL DEFAULT 'QUEUE_MODE',
ADD COLUMN     "originalReservationAt" TIMESTAMPTZ(3),
ADD COLUMN     "reservationAt" TIMESTAMPTZ(3),
ADD COLUMN     "schedulingAllotmentMinutes" INTEGER,
ADD COLUMN     "serviceStartedAt" TIMESTAMPTZ(3);

ALTER TABLE "BookingDraft" ADD COLUMN     "fragmentedReservations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservationAt" TIMESTAMPTZ(3);

ALTER TABLE "BookingDraftMember" ADD COLUMN     "reservationAt" TIMESTAMPTZ(3);

ALTER TABLE "DoctorAccountSettings" ADD COLUMN     "defaultAppointmentMode" "AppointmentMode" NOT NULL DEFAULT 'QUEUE_MODE';

ALTER TABLE "DoctorPracticeScheduleDraft" ADD COLUMN     "appointmentModeProposal" JSONB;

ALTER TABLE "SecretarySettingsDraft" ADD COLUMN     "appointmentModeProposal" JSONB;

CREATE TABLE "AppointmentModeConfiguration" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "effectiveServiceDate" DATE NOT NULL,
    "appointmentMode" "AppointmentMode" NOT NULL,
    "maximumBookableMinutes" INTEGER,
    "protectedPeriods" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "sourceDraftId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentModeConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentReservationEvent" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" "QueueEventActorType" NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "previousReservationAt" TIMESTAMPTZ(3),
    "reservationAt" TIMESTAMPTZ(3) NOT NULL,
    "availabilityOverride" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentReservationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentModeConfiguration_practiceLocationId_effectiveSe_idx" ON "AppointmentModeConfiguration"("practiceLocationId", "effectiveServiceDate", "createdAt");

CREATE INDEX "AppointmentReservationEvent_appointmentId_createdAt_idx" ON "AppointmentReservationEvent"("appointmentId", "createdAt");

ALTER TABLE "AppointmentModeConfiguration" ADD CONSTRAINT "AppointmentModeConfiguration_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentReservationEvent" ADD CONSTRAINT "AppointmentReservationEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_reservation_mode_check" CHECK (
  ("appointmentMode" = 'QUEUE_MODE' AND "reservationAt" IS NULL AND "originalReservationAt" IS NULL AND "schedulingAllotmentMinutes" IS NULL)
  OR ("appointmentMode" = 'TIME_SLOT_MODE' AND "reservationAt" IS NOT NULL AND "originalReservationAt" IS NOT NULL AND "schedulingAllotmentMinutes" > 0)
);
ALTER TABLE "AppointmentModeConfiguration" ADD CONSTRAINT "AppointmentModeConfiguration_maximum_check"
  CHECK ("maximumBookableMinutes" IS NULL OR "maximumBookableMinutes" BETWEEN 1 AND 4320);
CREATE INDEX "Appointment_reservation_capacity_idx" ON "Appointment" ("practiceLocationId", "serviceDate", "reservationAt");

-- Defense in depth for every writer, including legacy commands and administrative SQL.
-- The shared doctor schedule lock also serializes effective-mode changes.
CREATE FUNCTION enforce_appointment_mode() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doctor_id text; effective_mode "AppointmentMode"; existing_mode "AppointmentMode";
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."appointmentMode" IS DISTINCT FROM OLD."appointmentMode"
      OR NEW."originalReservationAt" IS DISTINCT FROM OLD."originalReservationAt") THEN
    RAISE EXCEPTION 'Original appointment mode and reservation are immutable';
  END IF;
  IF TG_OP = 'INSERT' OR NEW."practiceLocationId" IS DISTINCT FROM OLD."practiceLocationId"
      OR NEW."serviceDate" IS DISTINCT FROM OLD."serviceDate" THEN
    SELECT "doctorProfileId" INTO doctor_id FROM "PracticeLocation" WHERE id = NEW."practiceLocationId";
    PERFORM pg_advisory_xact_lock(hashtextextended('DOCTOR_SCHEDULE|' || doctor_id, 0));
    SELECT "appointmentMode" INTO existing_mode FROM "Appointment"
      WHERE "practiceLocationId" = NEW."practiceLocationId" AND "serviceDate" = NEW."serviceDate" AND id <> NEW.id LIMIT 1;
    SELECT "appointmentMode" INTO effective_mode FROM "AppointmentModeConfiguration"
      WHERE "practiceLocationId" = NEW."practiceLocationId" AND "effectiveServiceDate" <= NEW."serviceDate"
      ORDER BY "effectiveServiceDate" DESC, "createdAt" DESC, id DESC LIMIT 1;
    IF NEW."appointmentMode" <> COALESCE(existing_mode, effective_mode, 'QUEUE_MODE'::"AppointmentMode") THEN
      RAISE EXCEPTION 'Appointment mode does not match the effective Service Date mode';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Appointment_mode_guard" BEFORE INSERT OR UPDATE OF "appointmentMode", "originalReservationAt", "practiceLocationId", "serviceDate"
  ON "Appointment" FOR EACH ROW EXECUTE FUNCTION enforce_appointment_mode();
