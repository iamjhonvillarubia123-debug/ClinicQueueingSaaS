-- M3S12: BookingQuestion type is immutable once any answer history exists.
-- This protects both temporary BookingDraftAnswer history and durable AppointmentAnswer history.

CREATE OR REPLACE FUNCTION "prevent_answered_booking_question_type_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."type" IS DISTINCT FROM NEW."type" AND (
    EXISTS (
      SELECT 1
      FROM "BookingDraftAnswer" bda
      WHERE bda."bookingQuestionId" = OLD."id"
      LIMIT 1
    )
    OR EXISTS (
      SELECT 1
      FROM "AppointmentAnswer" aa
      WHERE aa."bookingQuestionId" = OLD."id"
      LIMIT 1
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'BookingQuestion type cannot change after answer history exists.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "BookingQuestion_type_history_guard" ON "BookingQuestion";

CREATE TRIGGER "BookingQuestion_type_history_guard"
BEFORE UPDATE OF "type" ON "BookingQuestion"
FOR EACH ROW
EXECUTE FUNCTION "prevent_answered_booking_question_type_change"();
