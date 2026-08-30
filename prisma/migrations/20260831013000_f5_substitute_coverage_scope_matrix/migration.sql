-- Reconcile the global CommandIdempotency matrix with the F5 coverage commands
-- and enforce their persisted target/result reference shape.

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
    'WHEN ''PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE''::"CommandType" THEN true WHEN ''PRACTICE_LOCATION_REPLACE_SUBSTITUTE_COVERAGE''::"CommandType" THEN true WHEN ''PRACTICE_LOCATION_CANCEL_SUBSTITUTE_COVERAGE''::"CommandType" THEN true ELSE false'
  );

  IF updated_definition = existing_definition THEN
    updated_definition := replace(
      existing_definition,
      'ELSE FALSE',
      'WHEN ''PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE''::"CommandType" THEN TRUE WHEN ''PRACTICE_LOCATION_REPLACE_SUBSTITUTE_COVERAGE''::"CommandType" THEN TRUE WHEN ''PRACTICE_LOCATION_CANCEL_SUBSTITUTE_COVERAGE''::"CommandType" THEN TRUE ELSE FALSE'
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

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_substitute_coverage_scope_check"
  CHECK (
    CASE "commandType"
      WHEN 'PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE' THEN
        "practiceLocationId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "accountUserId" IS NOT NULL
        AND "substituteSecretaryCoverageId" IS NULL
        AND "resultSubstituteSecretaryCoverageId" IS NOT NULL
      WHEN 'PRACTICE_LOCATION_REPLACE_SUBSTITUTE_COVERAGE' THEN
        "practiceLocationId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "accountUserId" IS NOT NULL
        AND "substituteSecretaryCoverageId" IS NOT NULL
        AND "resultSubstituteSecretaryCoverageId" IS NOT NULL
      WHEN 'PRACTICE_LOCATION_CANCEL_SUBSTITUTE_COVERAGE' THEN
        "practiceLocationId" IS NOT NULL
        AND "actorUserId" IS NOT NULL
        AND "accountUserId" IS NULL
        AND "substituteSecretaryCoverageId" IS NOT NULL
        AND "resultSubstituteSecretaryCoverageId" = "substituteSecretaryCoverageId"
      ELSE TRUE
    END
  );
