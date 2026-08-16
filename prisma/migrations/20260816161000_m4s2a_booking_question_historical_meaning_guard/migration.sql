-- M4S2A: protect BookingQuestion historical meaning once answer history exists.
-- Protected meaning: PracticeLocation ownership, question text, type, and select option values.
-- Other operational/display fields may continue to change under approved application rules.

CREATE OR REPLACE FUNCTION "prevent_answered_booking_question_meaning_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    OLD."practiceLocationId" IS DISTINCT FROM NEW."practiceLocationId"
    OR OLD."questionText" IS DISTINCT FROM NEW."questionText"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."selectOptions" IS DISTINCT FROM NEW."selectOptions"
  ) AND (
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
      MESSAGE = 'BookingQuestion historical meaning cannot change after answer history exists.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "BookingQuestion_type_history_guard" ON "BookingQuestion";
DROP TRIGGER IF EXISTS "BookingQuestion_meaning_history_guard" ON "BookingQuestion";

CREATE TRIGGER "BookingQuestion_meaning_history_guard"
BEFORE UPDATE OF "practiceLocationId", "questionText", "type", "selectOptions"
ON "BookingQuestion"
FOR EACH ROW
EXECUTE FUNCTION "prevent_answered_booking_question_meaning_change"();

DROP FUNCTION IF EXISTS "prevent_answered_booking_question_type_change"();
