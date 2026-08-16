-- Product Owner amendment: BookingQuestions are informational/preparation inputs only.
-- They must never add to or subtract from service duration/workload.
-- This bridge migration neutralizes all legacy values and prevents reintroduction
-- while application references are removed in controlled follow-on cleanup.

UPDATE "DoctorBookingQuestionTemplate"
SET "estimatedMinutesAdjustment" = 0
WHERE "estimatedMinutesAdjustment" <> 0;

UPDATE "BookingQuestion"
SET "estimatedMinutesAdjustment" = 0
WHERE "estimatedMinutesAdjustment" <> 0;

UPDATE "SecretarySettingsDraftBookingQuestion"
SET "proposedEstimatedMinutesAdjustment" = 0
WHERE "proposedEstimatedMinutesAdjustment" <> 0;

UPDATE "BookingDraftAnswer"
SET "estimatedMinutesAdjustment" = 0
WHERE "estimatedMinutesAdjustment" <> 0;

UPDATE "AppointmentAnswer"
SET "estimatedMinutesAdjustment" = 0
WHERE "estimatedMinutesAdjustment" <> 0;

ALTER TABLE "DoctorBookingQuestionTemplate"
  ADD CONSTRAINT "DoctorBookingQuestionTemplate_duration_adjustment_zero_check"
  CHECK ("estimatedMinutesAdjustment" = 0);

ALTER TABLE "BookingQuestion"
  ADD CONSTRAINT "BookingQuestion_duration_adjustment_zero_check"
  CHECK ("estimatedMinutesAdjustment" = 0);

ALTER TABLE "SecretarySettingsDraftBookingQuestion"
  ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_duration_adjustment_zero_check"
  CHECK ("proposedEstimatedMinutesAdjustment" = 0);

ALTER TABLE "BookingDraftAnswer"
  ADD CONSTRAINT "BookingDraftAnswer_duration_adjustment_zero_check"
  CHECK ("estimatedMinutesAdjustment" = 0);

ALTER TABLE "AppointmentAnswer"
  ADD CONSTRAINT "AppointmentAnswer_duration_adjustment_zero_check"
  CHECK ("estimatedMinutesAdjustment" = 0);
