-- M7S5B1 CANCEL APPOINTMENT GLOBAL SCOPE MATRIX RECONCILIATION
--
-- The prior M7S5B1 migration added an exact CANCEL_APPOINTMENT-specific CHECK,
-- but the older global CommandIdempotency matrix rejects command types that it
-- does not explicitly recognize (ELSE FALSE).
--
-- Preserve the established matrix exactly and teach it to defer the
-- CANCEL_APPOINTMENT row-shape validation to the dedicated M7S5B1 CHECK.

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
    'WHEN ''CANCEL_APPOINTMENT''::"CommandType" THEN true ELSE false'
  );

  IF updated_definition = existing_definition THEN
    updated_definition := replace(
      existing_definition,
      'ELSE FALSE',
      'WHEN ''CANCEL_APPOINTMENT''::"CommandType" THEN TRUE ELSE FALSE'
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
