-- Preserve every existing command scope; add exact shapes for reservation commands.
ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_reservation_scope_check" CHECK (
  "commandType" NOT IN ('RESCHEDULE_APPOINTMENT','START_APPOINTMENT_SERVICE','PATIENT_CANCEL_APPOINTMENT') OR (
    "practiceLocationId" IS NOT NULL AND "serviceDate" IS NOT NULL AND "appointmentId" IS NOT NULL
    AND "resultAppointmentId" = "appointmentId"
    AND ("commandType" <> 'START_APPOINTMENT_SERVICE' OR "actorUserId" IS NOT NULL)
    AND "bookingDraftId" IS NULL AND "bookingRecoveryAttemptId" IS NULL AND "accountUserId" IS NULL
    AND "bookingGroupId" IS NULL AND "bookingGroupRecoveryAttemptId" IS NULL AND "doctorFinancialAccountId" IS NULL
    AND "resultQueueEventId" IS NULL AND "resultBookingGroupId" IS NULL AND "resultBookingGroupAccessTokenId" IS NULL
    AND "resultAdministrativeAccountActionId" IS NULL AND "substituteSecretaryCoverageId" IS NULL
    AND "resultSubstituteSecretaryCoverageId" IS NULL
  )
);
DO $$
DECLARE original text; revised text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint
    WHERE conrelid='"CommandIdempotency"'::regclass AND conname='CommandIdempotency_command_scope_matrix_check';
  revised := replace(original, 'ELSE false', 'WHEN ''RESCHEDULE_APPOINTMENT''::"CommandType" THEN true WHEN ''START_APPOINTMENT_SERVICE''::"CommandType" THEN true WHEN ''PATIENT_CANCEL_APPOINTMENT''::"CommandType" THEN true ELSE false');
  IF original IS NULL OR revised=original THEN RAISE EXCEPTION 'Expected command scope guard not found'; END IF;
  ALTER TABLE "CommandIdempotency" DROP CONSTRAINT "CommandIdempotency_command_scope_matrix_check";
  EXECUTE format('ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_command_scope_matrix_check" %s',revised);
END $$;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_patient_cancel_after_service" CHECK (
  NOT ("appointmentMode"='TIME_SLOT_MODE' AND "serviceStartedAt" IS NOT NULL AND "cancelledByType"='PATIENT')
);
