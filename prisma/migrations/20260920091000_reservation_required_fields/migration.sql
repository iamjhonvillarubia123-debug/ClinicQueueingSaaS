-- SQL CHECK treats UNKNOWN as passing: require non-null Time-Slot fields explicitly.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_reservation_mode_check";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_reservation_mode_check" CHECK (
  ("appointmentMode" = 'QUEUE_MODE' AND "reservationAt" IS NULL AND "originalReservationAt" IS NULL AND "schedulingAllotmentMinutes" IS NULL)
  OR ("appointmentMode" = 'TIME_SLOT_MODE' AND "reservationAt" IS NOT NULL AND "originalReservationAt" IS NOT NULL
      AND "schedulingAllotmentMinutes" IS NOT NULL AND "schedulingAllotmentMinutes" > 0)
);
ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_reservation_result_required" CHECK (
  "commandType" NOT IN ('RESCHEDULE_APPOINTMENT','START_APPOINTMENT_SERVICE','PATIENT_CANCEL_APPOINTMENT')
  OR (("appointmentId" IS NULL AND "resultAppointmentId" IS NULL AND "expiresAt" <= CURRENT_TIMESTAMP)
    OR ("appointmentId" IS NOT NULL AND "resultAppointmentId" IS NOT NULL AND "appointmentId" = "resultAppointmentId"))
);
