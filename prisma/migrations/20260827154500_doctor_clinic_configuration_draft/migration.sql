ALTER TABLE "PracticeLocation"
ADD COLUMN "shortCode" VARCHAR(40),
ADD COLUMN "clinicEmail" VARCHAR(255),
ADD COLUMN "clinicDescription" VARCHAR(250);

CREATE UNIQUE INDEX "PracticeLocation_doctorProfileId_shortCode_key"
ON "PracticeLocation"("doctorProfileId", "shortCode");

ALTER TABLE "DoctorServiceTemplate"
ADD COLUMN "description" VARCHAR(250);

ALTER TABLE "PracticeLocationService"
ADD COLUMN "description" VARCHAR(250);

-- The existing schedule-draft header becomes the Doctor-owned whole-clinic
-- working-draft header. The physical table name is retained to preserve the
-- already deployed schedule-draft data without a destructive rename.
ALTER TABLE "DoctorPracticeScheduleDraft"
ADD COLUMN "name" VARCHAR(200),
ADD COLUMN "shortCode" VARCHAR(40),
ADD COLUMN "addressLine1" VARCHAR(255),
ADD COLUMN "addressLine2" VARCHAR(255),
ADD COLUMN "cityMunicipality" VARCHAR(120),
ADD COLUMN "province" VARCHAR(120),
ADD COLUMN "postalCode" VARCHAR(20),
ADD COLUMN "contactNumber" VARCHAR(30),
ADD COLUMN "clinicEmail" VARCHAR(255),
ADD COLUMN "clinicDescription" VARCHAR(250),
ADD COLUMN "countryCode" CHAR(2),
ADD COLUMN "timeZone" VARCHAR(100);

CREATE TABLE "DoctorPracticeConfigurationDraftService" (
    "id" TEXT NOT NULL,
    "doctorPracticeScheduleDraftId" TEXT NOT NULL,
    "effectiveServiceId" TEXT,
    "sourceDoctorServiceTemplateId" TEXT,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(250),
    "durationMinutes" INTEGER NOT NULL,
    "status" "ServiceAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DoctorPracticeConfigurationDraftService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DoctorPracticeConfigurationDraftService_draft_idx"
ON "DoctorPracticeConfigurationDraftService"("doctorPracticeScheduleDraftId");
CREATE INDEX "DoctorPracticeConfigurationDraftService_effective_idx"
ON "DoctorPracticeConfigurationDraftService"("effectiveServiceId");

ALTER TABLE "DoctorPracticeConfigurationDraftService"
ADD CONSTRAINT "DoctorPracticeConfigurationDraftService_draft_fkey"
FOREIGN KEY ("doctorPracticeScheduleDraftId") REFERENCES "DoctorPracticeScheduleDraft"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DoctorPracticeConfigurationDraftBookingQuestion" (
    "id" TEXT NOT NULL,
    "doctorPracticeScheduleDraftId" TEXT NOT NULL,
    "effectiveBookingQuestionId" TEXT,
    "sourceDoctorBookingQuestionTemplateId" TEXT,
    "questionText" VARCHAR(500) NOT NULL,
    "type" "BookingQuestionType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DoctorPracticeConfigurationDraftBookingQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoctorPracticeConfigurationDraftBookingQuestion_order_key"
ON "DoctorPracticeConfigurationDraftBookingQuestion"("doctorPracticeScheduleDraftId", "displayOrder");
CREATE INDEX "DoctorPracticeConfigurationDraftBookingQuestion_draft_idx"
ON "DoctorPracticeConfigurationDraftBookingQuestion"("doctorPracticeScheduleDraftId");
CREATE INDEX "DoctorPracticeConfigurationDraftBookingQuestion_effective_idx"
ON "DoctorPracticeConfigurationDraftBookingQuestion"("effectiveBookingQuestionId");

ALTER TABLE "DoctorPracticeConfigurationDraftBookingQuestion"
ADD CONSTRAINT "DoctorPracticeConfigurationDraftBookingQuestion_draft_fkey"
FOREIGN KEY ("doctorPracticeScheduleDraftId") REFERENCES "DoctorPracticeScheduleDraft"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
