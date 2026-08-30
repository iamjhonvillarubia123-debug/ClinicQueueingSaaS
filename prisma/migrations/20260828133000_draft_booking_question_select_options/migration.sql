CREATE TABLE "DoctorPracticeConfigurationDraftBookingQuestionOption" (
    "id" TEXT NOT NULL,
    "bookingQuestionDraftId" TEXT NOT NULL,
    "optionValue" VARCHAR(100) NOT NULL,
    "optionLabel" VARCHAR(200) NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorPracticeConfigurationDraftBookingQuestionOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DPConfigDraftQuestionOption_question_value_key"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId", "optionValue");

CREATE UNIQUE INDEX "DPConfigDraftQuestionOption_question_order_key"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId", "displayOrder");

CREATE INDEX "DPConfigDraftQuestionOption_question_idx"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId");

ALTER TABLE "DoctorPracticeConfigurationDraftBookingQuestionOption"
ADD CONSTRAINT "DPConfigDraftQuestionOption_question_fkey"
FOREIGN KEY ("bookingQuestionDraftId") REFERENCES "DoctorPracticeConfigurationDraftBookingQuestion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
