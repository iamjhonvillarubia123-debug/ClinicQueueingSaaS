-- M6S1: approved active BookingDraft and Appointment concurrency backstops.

ALTER TABLE "BookingDraft"
ADD COLUMN "activeDraftKey" VARCHAR(64);

ALTER TABLE "Appointment"
ADD COLUMN "activeAppointmentKey" VARCHAR(64);

CREATE UNIQUE INDEX "BookingDraft_activeDraftKey_key"
ON "BookingDraft"("activeDraftKey");

CREATE UNIQUE INDEX "Appointment_activeAppointmentKey_key"
ON "Appointment"("activeAppointmentKey");

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_activeDraftKey_length_check"
CHECK ("activeDraftKey" IS NULL OR length("activeDraftKey") = 64);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_terminal_activeDraftKey_check"
CHECK (
  "status" NOT IN ('CONSUMED', 'EXPIRED', 'CANCELLED')
  OR "activeDraftKey" IS NULL
);

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_activeAppointmentKey_length_check"
CHECK (
  "activeAppointmentKey" IS NULL
  OR length("activeAppointmentKey") = 64
);

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_terminal_activeAppointmentKey_check"
CHECK (
  "status" NOT IN ('COMPLETED', 'EXPIRED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED')
  OR "activeAppointmentKey" IS NULL
);
