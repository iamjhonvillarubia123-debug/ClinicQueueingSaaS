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

CREATE UNIQUE INDEX "DoctorPracticeConfigurationDraftBookingQuestionOption_bookingQuestionDraftId_optionValue_key"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId", "optionValue");

CREATE UNIQUE INDEX "DoctorPracticeConfigurationDraftBookingQuestionOption_bookingQuestionDraftId_displayOrder_key"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId", "displayOrder");

CREATE INDEX "DoctorPracticeConfigurationDraftBookingQuestionOption_bookingQuestionDraftId_idx"
ON "DoctorPracticeConfigurationDraftBookingQuestionOption"("bookingQuestionDraftId");

ALTER TABLE "DoctorPracticeConfigurationDraftBookingQuestionOption"
ADD CONSTRAINT "DoctorPracticeConfigurationDraftBookingQuestionOption_bookingQuestionDraftId_fkey"
FOREIGN KEY ("bookingQuestionDraftId") REFERENCES "DoctorPracticeConfigurationDraftBookingQuestion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
