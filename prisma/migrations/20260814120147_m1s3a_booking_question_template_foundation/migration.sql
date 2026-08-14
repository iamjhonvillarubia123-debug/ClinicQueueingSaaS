-- CreateTable
CREATE TABLE "DoctorBookingQuestionTemplate" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "questionText" VARCHAR(500) NOT NULL,
    "helpText" VARCHAR(500),
    "type" "BookingQuestionType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "estimatedMinutesAdjustment" INTEGER NOT NULL DEFAULT 0,
    "textMaximumLength" INTEGER,
    "numberMinimum" DECIMAL(65,30),
    "numberMaximum" DECIMAL(65,30),
    "selectOptions" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorBookingQuestionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretarySettingsDraftBookingQuestion" (
    "id" TEXT NOT NULL,
    "secretarySettingsDraftId" TEXT NOT NULL,
    "bookingQuestionId" TEXT,
    "sourceDoctorBookingQuestionTemplateId" TEXT,
    "proposedQuestionText" VARCHAR(500) NOT NULL,
    "proposedHelpText" VARCHAR(500),
    "proposedType" "BookingQuestionType" NOT NULL,
    "proposedIsRequired" BOOLEAN NOT NULL DEFAULT false,
    "proposedDisplayOrder" INTEGER NOT NULL,
    "proposedIsActive" BOOLEAN NOT NULL DEFAULT true,
    "proposedEstimatedMinutesAdjustment" INTEGER NOT NULL DEFAULT 0,
    "proposedTextMaximumLength" INTEGER,
    "proposedNumberMinimum" DECIMAL(65,30),
    "proposedNumberMaximum" DECIMAL(65,30),
    "proposedSelectOptions" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraftBookingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorBookingQuestionTemplate_doctorProfileId_isActive_disp_idx" ON "DoctorBookingQuestionTemplate"("doctorProfileId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorBookingQuestionTemplate_doctorProfileId_displayOrder_key" ON "DoctorBookingQuestionTemplate"("doctorProfileId", "displayOrder");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftBookingQuestion_secretarySettingsDraf_idx" ON "SecretarySettingsDraftBookingQuestion"("secretarySettingsDraftId");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftBookingQuestion_bookingQuestionId_idx" ON "SecretarySettingsDraftBookingQuestion"("bookingQuestionId");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftBookingQuestion_sourceDoctorBookingQu_idx" ON "SecretarySettingsDraftBookingQuestion"("sourceDoctorBookingQuestionTemplateId");

-- AddForeignKey
ALTER TABLE "DoctorBookingQuestionTemplate" ADD CONSTRAINT "DoctorBookingQuestionTemplate_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftBookingQuestion" ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_secretarySettingsDra_fkey" FOREIGN KEY ("secretarySettingsDraftId") REFERENCES "SecretarySettingsDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftBookingQuestion" ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_bookingQuestionId_fkey" FOREIGN KEY ("bookingQuestionId") REFERENCES "BookingQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S3A MANUAL POSTGRESQL CONSTRAINTS

-- Doctor-wide BookingQuestion template stable scalar constraints.
ALTER TABLE "DoctorBookingQuestionTemplate"
ADD CONSTRAINT "DoctorBookingQuestionTemplate_display_order_check"
CHECK ("displayOrder" >= 0);

ALTER TABLE "DoctorBookingQuestionTemplate"
ADD CONSTRAINT "DoctorBookingQuestionTemplate_text_maximum_length_check"
CHECK ("textMaximumLength" IS NULL OR "textMaximumLength" > 0);

ALTER TABLE "DoctorBookingQuestionTemplate"
ADD CONSTRAINT "DoctorBookingQuestionTemplate_number_range_check"
CHECK (
    "numberMinimum" IS NULL
    OR "numberMaximum" IS NULL
    OR "numberMinimum" <= "numberMaximum"
);

-- Type-specific nullable-field consistency.
-- selectOptions JSON internal structure remains backend validation.
ALTER TABLE "DoctorBookingQuestionTemplate"
ADD CONSTRAINT "DoctorBookingQuestionTemplate_type_shape_check"
CHECK (
    (
        "type" = 'TEXT'::"BookingQuestionType"
        AND "numberMinimum" IS NULL
        AND "numberMaximum" IS NULL
        AND "selectOptions" IS NULL
    )
    OR
    (
        "type" = 'NUMBER'::"BookingQuestionType"
        AND "textMaximumLength" IS NULL
        AND "selectOptions" IS NULL
    )
    OR
    (
        "type" = 'BOOLEAN'::"BookingQuestionType"
        AND "textMaximumLength" IS NULL
        AND "numberMinimum" IS NULL
        AND "numberMaximum" IS NULL
        AND "selectOptions" IS NULL
    )
    OR
    (
        "type" = 'SINGLE_SELECT'::"BookingQuestionType"
        AND "textMaximumLength" IS NULL
        AND "numberMinimum" IS NULL
        AND "numberMaximum" IS NULL
        AND "selectOptions" IS NOT NULL
    )
);

-- Secretary BookingQuestion proposal stable scalar constraints.
ALTER TABLE "SecretarySettingsDraftBookingQuestion"
ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_display_order_check"
CHECK ("proposedDisplayOrder" >= 0);

ALTER TABLE "SecretarySettingsDraftBookingQuestion"
ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_text_maximum_length_check"
CHECK (
    "proposedTextMaximumLength" IS NULL
    OR "proposedTextMaximumLength" > 0
);

ALTER TABLE "SecretarySettingsDraftBookingQuestion"
ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_number_range_check"
CHECK (
    "proposedNumberMinimum" IS NULL
    OR "proposedNumberMaximum" IS NULL
    OR "proposedNumberMinimum" <= "proposedNumberMaximum"
);

ALTER TABLE "SecretarySettingsDraftBookingQuestion"
ADD CONSTRAINT "SecretarySettingsDraftBookingQuestion_type_shape_check"
CHECK (
    (
        "proposedType" = 'TEXT'::"BookingQuestionType"
        AND "proposedNumberMinimum" IS NULL
        AND "proposedNumberMaximum" IS NULL
        AND "proposedSelectOptions" IS NULL
    )
    OR
    (
        "proposedType" = 'NUMBER'::"BookingQuestionType"
        AND "proposedTextMaximumLength" IS NULL
        AND "proposedSelectOptions" IS NULL
    )
    OR
    (
        "proposedType" = 'BOOLEAN'::"BookingQuestionType"
        AND "proposedTextMaximumLength" IS NULL
        AND "proposedNumberMinimum" IS NULL
        AND "proposedNumberMaximum" IS NULL
        AND "proposedSelectOptions" IS NULL
    )
    OR
    (
        "proposedType" = 'SINGLE_SELECT'::"BookingQuestionType"
        AND "proposedTextMaximumLength" IS NULL
        AND "proposedNumberMinimum" IS NULL
        AND "proposedNumberMaximum" IS NULL
        AND "proposedSelectOptions" IS NOT NULL
    )
);

-- One Secretary settings draft must not contain two separate proposals
-- targeting the same existing effective BookingQuestion.
CREATE UNIQUE INDEX "SecretarySettingsDraftBookingQuestion_existing_target_key"
ON "SecretarySettingsDraftBookingQuestion"(
    "secretarySettingsDraftId",
    "bookingQuestionId"
)
WHERE "bookingQuestionId" IS NOT NULL;