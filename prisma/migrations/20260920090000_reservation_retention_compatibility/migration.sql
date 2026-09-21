-- Reservation history follows its parent through the existing retention/erasure gate.
ALTER TABLE "AppointmentReservationEvent" DROP CONSTRAINT "AppointmentReservationEvent_appointmentId_fkey";
ALTER TABLE "AppointmentReservationEvent" ADD CONSTRAINT "AppointmentReservationEvent_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expired command receipts may be unlinked by existing erasure and backup replay.
-- Live commands still require both matching appointment identifiers.
ALTER TABLE "CommandIdempotency" DROP CONSTRAINT "CommandIdempotency_reservation_scope_check";
ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_reservation_scope_check" CHECK (
  "commandType" NOT IN ('RESCHEDULE_APPOINTMENT','START_APPOINTMENT_SERVICE','PATIENT_CANCEL_APPOINTMENT') OR (
    "practiceLocationId" IS NOT NULL AND "serviceDate" IS NOT NULL
    AND (("appointmentId" IS NOT NULL AND "resultAppointmentId" = "appointmentId")
      OR ("appointmentId" IS NULL AND "resultAppointmentId" IS NULL AND "expiresAt" <= CURRENT_TIMESTAMP))
    AND ("commandType" <> 'START_APPOINTMENT_SERVICE' OR "actorUserId" IS NOT NULL)
    AND "bookingDraftId" IS NULL AND "bookingRecoveryAttemptId" IS NULL AND "accountUserId" IS NULL
    AND "bookingGroupId" IS NULL AND "bookingGroupRecoveryAttemptId" IS NULL AND "doctorFinancialAccountId" IS NULL
    AND "resultQueueEventId" IS NULL AND "resultBookingGroupId" IS NULL AND "resultBookingGroupAccessTokenId" IS NULL
    AND "resultAdministrativeAccountActionId" IS NULL AND "substituteSecretaryCoverageId" IS NULL
    AND "resultSubstituteSecretaryCoverageId" IS NULL
  )
);
