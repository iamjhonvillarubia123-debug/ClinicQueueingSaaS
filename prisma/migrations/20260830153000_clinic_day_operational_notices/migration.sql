ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'START_CLINIC_DAY_OPERATIONAL_NOTICE';
ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'END_CLINIC_DAY_OPERATIONAL_NOTICE';

CREATE TYPE "ClinicDayOperationalNoticeKind" AS ENUM ('DELAYED_OPENING', 'SERVING_BREAK');
CREATE TYPE "ClinicDayOperationalNoticeStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TABLE "ClinicDayOperationalNotice" (
    "id" TEXT NOT NULL,
    "clinicDayId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "kind" "ClinicDayOperationalNoticeKind" NOT NULL,
    "status" "ClinicDayOperationalNoticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(120) NOT NULL,
    "message" VARCHAR(500),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "expectedResumeAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "createdByUserId" TEXT NOT NULL,
    "endedByUserId" TEXT,
    "activeNoticeKey" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ClinicDayOperationalNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicDayOperationalNotice_activeNoticeKey_key" ON "ClinicDayOperationalNotice"("activeNoticeKey");
CREATE INDEX "ClinicDayOperationalNotice_practiceLocationId_serviceDate_status_idx" ON "ClinicDayOperationalNotice"("practiceLocationId", "serviceDate", "status");
CREATE INDEX "ClinicDayOperationalNotice_clinicDayId_createdAt_idx" ON "ClinicDayOperationalNotice"("clinicDayId", "createdAt");

ALTER TABLE "ClinicDayOperationalNotice" ADD CONSTRAINT "ClinicDayOperationalNotice_clinicDayId_fkey" FOREIGN KEY ("clinicDayId") REFERENCES "ClinicDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperationalNotice" ADD CONSTRAINT "ClinicDayOperationalNotice_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperationalNotice" ADD CONSTRAINT "ClinicDayOperationalNotice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicDayOperationalNotice" ADD CONSTRAINT "ClinicDayOperationalNotice_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
