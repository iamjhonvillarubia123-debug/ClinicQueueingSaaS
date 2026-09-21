ALTER TABLE "CommandIdempotency" DROP CONSTRAINT "CommandIdempotency_reservation_scope_check";
ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_reservation_scope_check" CHECK (
  "commandType" NOT IN ('RESCHEDULE_APPOINTMENT','START_APPOINTMENT_SERVICE','PATIENT_CANCEL_APPOINTMENT') OR (
    "practiceLocationId" IS NOT NULL AND "serviceDate" IS NOT NULL
    AND (("appointmentId" IS NOT NULL AND "resultAppointmentId" IS NOT NULL AND "resultAppointmentId" = "appointmentId")
      OR ("appointmentId" IS NULL AND "resultAppointmentId" IS NULL))
    AND ("commandType" <> 'START_APPOINTMENT_SERVICE' OR "actorUserId" IS NOT NULL)
    AND "bookingDraftId" IS NULL AND "bookingRecoveryAttemptId" IS NULL AND "accountUserId" IS NULL
    AND "bookingGroupId" IS NULL AND "bookingGroupRecoveryAttemptId" IS NULL AND "doctorFinancialAccountId" IS NULL
    AND "resultQueueEventId" IS NULL AND "resultBookingGroupId" IS NULL AND "resultBookingGroupAccessTokenId" IS NULL
    AND "resultAdministrativeAccountActionId" IS NULL AND "substituteSecretaryCoverageId" IS NULL
    AND "resultSubstituteSecretaryCoverageId" IS NULL
  )
);

ALTER TABLE "CommandIdempotency" DROP CONSTRAINT "CommandIdempotency_reservation_result_required";
-- Existing appointment erasure happens after 24h, before receipt expiry.
-- Permit unlinking only after the existing erasure ledger has been written.
CREATE FUNCTION guard_reservation_command_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."commandType" IN ('RESCHEDULE_APPOINTMENT','START_APPOINTMENT_SERVICE','PATIENT_CANCEL_APPOINTMENT')
     AND NEW."appointmentId" IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'A new reservation command requires an appointment';
    END IF;
    IF OLD."appointmentId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "PrivacyErasureLedger" WHERE "resourceType" = 'APPOINTMENT' AND "resourceId" = OLD."appointmentId"
    ) THEN
      RAISE EXCEPTION 'Reservation command unlinking requires committed erasure authority';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommandIdempotency_reservation_erasure_guard" BEFORE INSERT OR UPDATE
  ON "CommandIdempotency" FOR EACH ROW EXECUTE FUNCTION guard_reservation_command_erasure();
