-- Preserve receipt lifetime while unlinking erased personal records.
ALTER TABLE "CommandIdempotency" ADD COLUMN "privacyErasedAt" TIMESTAMPTZ(3);
CREATE FUNCTION guard_command_privacy_unlink() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE appointment_id text; group_id text;
BEGIN
  IF NEW."privacyErasedAt" IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'New commands cannot be privacy-erased'; END IF;
    IF (to_jsonb(NEW) - ARRAY['privacyErasedAt','appointmentId','resultAppointmentId','bookingGroupId','resultBookingGroupId','resultBookingGroupAccessTokenId'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['privacyErasedAt','appointmentId','resultAppointmentId','bookingGroupId','resultBookingGroupId','resultBookingGroupAccessTokenId']) THEN
      RAISE EXCEPTION 'Erasure may only unlink resource references';
    END IF;
    appointment_id := COALESCE(OLD."appointmentId", OLD."resultAppointmentId");
    group_id := COALESCE(OLD."bookingGroupId", OLD."resultBookingGroupId");
    IF OLD."privacyErasedAt" IS NULL AND NOT (
      (appointment_id IS NOT NULL AND EXISTS (SELECT 1 FROM "PrivacyErasureLedger" WHERE "resourceType" = 'APPOINTMENT' AND "resourceId" = appointment_id))
      OR (group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Appointment" WHERE "bookingGroupId" = group_id))
    ) THEN RAISE EXCEPTION 'Command unlinking requires erasure authority'; END IF;
    IF (NEW."appointmentId" IS NOT NULL AND NEW."appointmentId" IS DISTINCT FROM OLD."appointmentId")
       OR (NEW."resultAppointmentId" IS NOT NULL AND NEW."resultAppointmentId" IS DISTINCT FROM OLD."resultAppointmentId")
       OR (NEW."bookingGroupId" IS NOT NULL AND NEW."bookingGroupId" IS DISTINCT FROM OLD."bookingGroupId")
       OR (NEW."resultBookingGroupId" IS NOT NULL AND NEW."resultBookingGroupId" IS DISTINCT FROM OLD."resultBookingGroupId")
       OR (NEW."resultBookingGroupAccessTokenId" IS NOT NULL AND NEW."resultBookingGroupAccessTokenId" IS DISTINCT FROM OLD."resultBookingGroupAccessTokenId") THEN
      RAISE EXCEPTION 'Erasure cannot create or replace resource references';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD."privacyErasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Erasure marker cannot be removed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommandIdempotency_privacy_unlink_guard" BEFORE INSERT OR UPDATE
  ON "CommandIdempotency" FOR EACH ROW EXECUTE FUNCTION guard_command_privacy_unlink();
-- Existing exact command shapes remain mandatory unless the guarded erasure path ran.
DO $$
DECLARE constraint_row record; expression text;
BEGIN
  FOR constraint_row IN SELECT conname, pg_get_expr(conbin, conrelid) AS expression
    FROM pg_constraint WHERE conrelid='"CommandIdempotency"'::regclass AND contype='c'
      AND (conname='CommandIdempotency_command_scope_matrix_check' OR conname LIKE '%scope%check')
  LOOP
    expression := constraint_row.expression;
    EXECUTE format('ALTER TABLE "CommandIdempotency" DROP CONSTRAINT %I', constraint_row.conname);
    EXECUTE format('ALTER TABLE "CommandIdempotency" ADD CONSTRAINT %I CHECK ("privacyErasedAt" IS NOT NULL OR (%s))', constraint_row.conname, expression);
  END LOOP;
END $$;
