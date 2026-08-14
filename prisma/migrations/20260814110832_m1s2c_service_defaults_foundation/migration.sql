-- CreateEnum
CREATE TYPE "ServiceAvailabilityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "DoctorServiceTemplate" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "ServiceAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorServiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLocationService" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "sourceDoctorServiceTemplateId" TEXT,
    "name" VARCHAR(150) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "ServiceAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeLocationService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretarySettingsDraftService" (
    "id" TEXT NOT NULL,
    "secretarySettingsDraftId" TEXT NOT NULL,
    "practiceLocationServiceId" TEXT,
    "sourceDoctorServiceTemplateId" TEXT,
    "proposedName" VARCHAR(150) NOT NULL,
    "proposedDurationMinutes" INTEGER NOT NULL,
    "proposedStatus" "ServiceAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraftService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorServiceTemplate_doctorProfileId_status_idx" ON "DoctorServiceTemplate"("doctorProfileId", "status");

-- CreateIndex
CREATE INDEX "DoctorServiceTemplate_doctorProfileId_name_idx" ON "DoctorServiceTemplate"("doctorProfileId", "name");

-- CreateIndex
CREATE INDEX "PracticeLocationService_practiceLocationId_status_idx" ON "PracticeLocationService"("practiceLocationId", "status");

-- CreateIndex
CREATE INDEX "PracticeLocationService_practiceLocationId_name_idx" ON "PracticeLocationService"("practiceLocationId", "name");

-- CreateIndex
CREATE INDEX "PracticeLocationService_sourceDoctorServiceTemplateId_idx" ON "PracticeLocationService"("sourceDoctorServiceTemplateId");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftService_secretarySettingsDraftId_idx" ON "SecretarySettingsDraftService"("secretarySettingsDraftId");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftService_practiceLocationServiceId_idx" ON "SecretarySettingsDraftService"("practiceLocationServiceId");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftService_sourceDoctorServiceTemplateId_idx" ON "SecretarySettingsDraftService"("sourceDoctorServiceTemplateId");

-- AddForeignKey
ALTER TABLE "DoctorServiceTemplate" ADD CONSTRAINT "DoctorServiceTemplate_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLocationService" ADD CONSTRAINT "PracticeLocationService_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftService" ADD CONSTRAINT "SecretarySettingsDraftService_secretarySettingsDraftId_fkey" FOREIGN KEY ("secretarySettingsDraftId") REFERENCES "SecretarySettingsDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftService" ADD CONSTRAINT "SecretarySettingsDraftService_practiceLocationServiceId_fkey" FOREIGN KEY ("practiceLocationServiceId") REFERENCES "PracticeLocationService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S2C MANUAL POSTGRESQL CONSTRAINTS

-- Canonical Service duration/workload boundary:
-- greater than zero and no more than 24 hours (1,440 minutes).
ALTER TABLE "DoctorServiceTemplate"
ADD CONSTRAINT "DoctorServiceTemplate_duration_minutes_check"
CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440);

ALTER TABLE "PracticeLocationService"
ADD CONSTRAINT "PracticeLocationService_duration_minutes_check"
CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440);

ALTER TABLE "SecretarySettingsDraftService"
ADD CONSTRAINT "SecretarySettingsDraftService_duration_minutes_check"
CHECK ("proposedDurationMinutes" > 0 AND "proposedDurationMinutes" <= 1440);

-- One Secretary settings draft must not contain two separate proposals that
-- target the same existing effective PracticeLocation Service.
-- NULL targets represent proposed new Services and remain intentionally
-- repeatable subject to application-level validation.
CREATE UNIQUE INDEX "SecretarySettingsDraftService_existing_target_key"
ON "SecretarySettingsDraftService"(
    "secretarySettingsDraftId",
    "practiceLocationServiceId"
)
WHERE "practiceLocationServiceId" IS NOT NULL;