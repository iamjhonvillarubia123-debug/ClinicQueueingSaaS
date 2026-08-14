-- M1S3D BOOKINGDRAFTANSWER VALUE SHAPE
-- A temporary answer may populate at most one typed value column.
-- Whether that populated column matches BookingQuestion.type remains
-- authoritative backend validation because it is a cross-table rule.
ALTER TABLE "BookingDraftAnswer"
ADD CONSTRAINT "BookingDraftAnswer_single_value_check"
CHECK (
    (CASE WHEN "answerText" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "answerNumber" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "answerBoolean" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "selectedOptionValue" IS NOT NULL THEN 1 ELSE 0 END)
  <= 1
);
