-- R3 OPERATIONAL NOTICE COMMAND IDEMPOTENCY SCOPE RECONCILIATION
--
-- START/END_CLINIC_DAY_OPERATIONAL_NOTICE were added after the original
-- global CommandIdempotency scope matrix. Because that matrix intentionally
-- rejects unknown command types through ELSE FALSE, valid operational-notice
-- idempotency rows could never be persisted.
--
-- Keep the global guard intact, explicitly defer these two command types to a
-- dedicated exact row-shape CHECK, and require the service's established
-- clinic/date/actor scope while rejecting unrelated command/result scopes.

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_operational_notice_scope_check"
  CHECK (
    "commandType" NOT IN (
      'START_CLINIC_DAY_OPERATIONAL_NOTICE',
      'END_CLINIC_DAY_OPERATIONAL_NOTICE'
    )
    OR (
      "practiceLocationId" IS NOT NULL
      AND "serviceDate" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "appointmentId" IS NULL
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "accountUserId" IS NULL
      AND "bookingGroupId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "doctorFinancialAccountId" IS NULL
      AND "resultAppointmentId" IS NULL
      AND "resultQueueEventId" IS NULL
      AND "resultBookingGroupId" IS NULL
      AND "resultBookingGroupAccessTokenId" IS NULL
      AND "resultAdministrativeAccountActionId" IS NULL
      AND "substituteSecretaryCoverageId" IS NULL
      AND "resultSubstituteSecretaryCoverageId" IS NULL
    )
  );

DO $$
DECLARE
  existing_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO existing_definition
  FROM pg_constraint c
  WHERE c.conrelid = '"CommandIdempotency"'::regclass
    AND c.conname = 'CommandIdempotency_command_scope_matrix_check';

  IF existing_definition IS NULL THEN
    RAISE EXCEPTION
      'CommandIdempotency_command_scope_matrix_check was not found';
  END IF;

  updated_definition := replace(
    existing_definition,
    'ELSE false',
    'WHEN ''START_CLINIC_DAY_OPERATIONAL_NOTICE''::"CommandType" THEN true WHEN ''END_CLINIC_DAY_OPERATIONAL_NOTICE''::"CommandType" THEN true ELSE false'
  );

  IF updated_definition = existing_definition THEN
    updated_definition := replace(
      existing_definition,
      'ELSE FALSE',
      'WHEN ''START_CLINIC_DAY_OPERATIONAL_NOTICE''::"CommandType" THEN TRUE WHEN ''END_CLINIC_DAY_OPERATIONAL_NOTICE''::"CommandType" THEN TRUE ELSE FALSE'
    );
  END IF;

  IF updated_definition = existing_definition THEN
    RAISE EXCEPTION
      'CommandIdempotency global scope matrix did not contain the expected ELSE FALSE branch';
  END IF;

  ALTER TABLE "CommandIdempotency"
    DROP CONSTRAINT "CommandIdempotency_command_scope_matrix_check";

  EXECUTE format(
    'ALTER TABLE "CommandIdempotency" ADD CONSTRAINT "CommandIdempotency_command_scope_matrix_check" %s',
    updated_definition
  );
END
$$;
