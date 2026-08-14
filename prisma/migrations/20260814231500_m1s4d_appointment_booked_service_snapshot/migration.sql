-- M1S4D APPOINTMENT BOOKED-SERVICE SNAPSHOT FOUNDATION
--
-- Stores immutable confirmed Service meaning for each Appointment.
-- Source PracticeLocationService identity remains available while the Appointment
-- exists, but later Service edits/retirement do not rewrite snapshot name/duration.
-- Snapshot rows are patient-owned children and therefore delete with Appointment.

CREATE TABLE "AppointmentBookedService" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "practiceLocationServiceId" TEXT NOT NULL,
  "serviceNameSnapshot" VARCHAR(150) NOT NULL,
  "durationMinutesSnapshot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentBookedService_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AppointmentBookedService"
  ADD CONSTRAINT "AppointmentBookedService_name_nonblank_check"
  CHECK (NULLIF(BTRIM("serviceNameSnapshot"), '') IS NOT NULL);

ALTER TABLE "AppointmentBookedService"
  ADD CONSTRAINT "AppointmentBookedService_duration_range_check"
  CHECK ("durationMinutesSnapshot" > 0 AND "durationMinutesSnapshot" <= 1440);

CREATE UNIQUE INDEX "AppointmentBookedService_appointment_service_key"
  ON "AppointmentBookedService"("appointmentId", "practiceLocationServiceId");

CREATE INDEX "AppointmentBookedService_appointmentId_idx"
  ON "AppointmentBookedService"("appointmentId");

CREATE INDEX "AppointmentBookedService_serviceId_idx"
  ON "AppointmentBookedService"("practiceLocationServiceId");

ALTER TABLE "AppointmentBookedService"
  ADD CONSTRAINT "AppointmentBookedService_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentBookedService"
  ADD CONSTRAINT "AppointmentBookedService_practiceLocationServiceId_fkey"
  FOREIGN KEY ("practiceLocationServiceId") REFERENCES "PracticeLocationService"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;