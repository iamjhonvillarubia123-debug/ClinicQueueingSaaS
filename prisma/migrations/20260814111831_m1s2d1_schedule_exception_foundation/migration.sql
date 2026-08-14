-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "PracticeSchedule" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "opensAtLocal" TIME(0),
    "closesAtLocal" TIME(0),
    "maximumOnlineBookingUntilLocal" TIME(0),
    "maximumOperatingUntilLocal" TIME(0),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "opensAtLocal" TIME(0),
    "closesAtLocal" TIME(0),
    "maximumOnlineBookingUntilLocal" TIME(0),
    "maximumOperatingUntilLocal" TIME(0),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretarySettingsDraftPracticeSchedule" (
    "id" TEXT NOT NULL,
    "secretarySettingsDraftId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "proposedIsOpen" BOOLEAN NOT NULL,
    "proposedOpensAtLocal" TIME(0),
    "proposedClosesAtLocal" TIME(0),
    "proposedMaximumOnlineBookingUntilLocal" TIME(0),
    "proposedMaximumOperatingUntilLocal" TIME(0),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraftPracticeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretarySettingsDraftScheduleException" (
    "id" TEXT NOT NULL,
    "secretarySettingsDraftId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "proposedIsOpen" BOOLEAN NOT NULL,
    "proposedOpensAtLocal" TIME(0),
    "proposedClosesAtLocal" TIME(0),
    "proposedMaximumOnlineBookingUntilLocal" TIME(0),
    "proposedMaximumOperatingUntilLocal" TIME(0),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraftScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeSchedule_practiceLocationId_idx" ON "PracticeSchedule"("practiceLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSchedule_practiceLocationId_weekday_key" ON "PracticeSchedule"("practiceLocationId", "weekday");

-- CreateIndex
CREATE INDEX "ScheduleException_practiceLocationId_serviceDate_idx" ON "ScheduleException"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleException_practiceLocationId_serviceDate_key" ON "ScheduleException"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftPracticeSchedule_secretarySettingsDra_idx" ON "SecretarySettingsDraftPracticeSchedule"("secretarySettingsDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretarySettingsDraftPracticeSchedule_secretarySettingsDra_key" ON "SecretarySettingsDraftPracticeSchedule"("secretarySettingsDraftId", "weekday");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraftScheduleException_secretarySettingsDr_idx" ON "SecretarySettingsDraftScheduleException"("secretarySettingsDraftId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "SecretarySettingsDraftScheduleException_secretarySettingsDr_key" ON "SecretarySettingsDraftScheduleException"("secretarySettingsDraftId", "serviceDate");

-- AddForeignKey
ALTER TABLE "PracticeSchedule" ADD CONSTRAINT "PracticeSchedule_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftPracticeSchedule" ADD CONSTRAINT "SecretarySettingsDraftPracticeSchedule_secretarySettingsDr_fkey" FOREIGN KEY ("secretarySettingsDraftId") REFERENCES "SecretarySettingsDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraftScheduleException" ADD CONSTRAINT "SecretarySettingsDraftScheduleException_secretarySettingsD_fkey" FOREIGN KEY ("secretarySettingsDraftId") REFERENCES "SecretarySettingsDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S2D1 MANUAL POSTGRESQL CONSTRAINTS

-- PracticeSchedule stable row shape.
-- maximumOperatingUntilLocal is intentionally independent from clinic hours
-- and is therefore not constrained by these checks.
ALTER TABLE "PracticeSchedule"
ADD CONSTRAINT "PracticeSchedule_row_shape_check"
CHECK (
    (
        "isOpen" = FALSE
        AND "opensAtLocal" IS NULL
        AND "closesAtLocal" IS NULL
        AND "maximumOnlineBookingUntilLocal" IS NULL
    )
    OR
    (
        "isOpen" = TRUE
        AND "opensAtLocal" IS NOT NULL
        AND "closesAtLocal" IS NOT NULL
        AND "opensAtLocal" < "closesAtLocal"
        AND (
            "maximumOnlineBookingUntilLocal" IS NULL
            OR (
                "maximumOnlineBookingUntilLocal" >= "opensAtLocal"
                AND "maximumOnlineBookingUntilLocal" <= "closesAtLocal"
            )
        )
    )
);

-- ScheduleException is a complete planned-date replacement for clinic hours
-- and public cutoff. maximumOperatingUntilLocal remains an independent
-- date-specific override.
ALTER TABLE "ScheduleException"
ADD CONSTRAINT "ScheduleException_row_shape_check"
CHECK (
    (
        "isOpen" = FALSE
        AND "opensAtLocal" IS NULL
        AND "closesAtLocal" IS NULL
        AND "maximumOnlineBookingUntilLocal" IS NULL
    )
    OR
    (
        "isOpen" = TRUE
        AND "opensAtLocal" IS NOT NULL
        AND "closesAtLocal" IS NOT NULL
        AND "opensAtLocal" < "closesAtLocal"
        AND (
            "maximumOnlineBookingUntilLocal" IS NULL
            OR (
                "maximumOnlineBookingUntilLocal" >= "opensAtLocal"
                AND "maximumOnlineBookingUntilLocal" <= "closesAtLocal"
            )
        )
    )
);

-- Secretary recurring-schedule proposal row shape mirrors the effective
-- PracticeSchedule invariants.
ALTER TABLE "SecretarySettingsDraftPracticeSchedule"
ADD CONSTRAINT "SecretarySettingsDraftPracticeSchedule_row_shape_check"
CHECK (
    (
        "proposedIsOpen" = FALSE
        AND "proposedOpensAtLocal" IS NULL
        AND "proposedClosesAtLocal" IS NULL
        AND "proposedMaximumOnlineBookingUntilLocal" IS NULL
    )
    OR
    (
        "proposedIsOpen" = TRUE
        AND "proposedOpensAtLocal" IS NOT NULL
        AND "proposedClosesAtLocal" IS NOT NULL
        AND "proposedOpensAtLocal" < "proposedClosesAtLocal"
        AND (
            "proposedMaximumOnlineBookingUntilLocal" IS NULL
            OR (
                "proposedMaximumOnlineBookingUntilLocal" >= "proposedOpensAtLocal"
                AND "proposedMaximumOnlineBookingUntilLocal" <= "proposedClosesAtLocal"
            )
        )
    )
);

-- Secretary date-exception proposal row shape mirrors the effective
-- ScheduleException invariants.
ALTER TABLE "SecretarySettingsDraftScheduleException"
ADD CONSTRAINT "SecretarySettingsDraftScheduleException_row_shape_check"
CHECK (
    (
        "proposedIsOpen" = FALSE
        AND "proposedOpensAtLocal" IS NULL
        AND "proposedClosesAtLocal" IS NULL
        AND "proposedMaximumOnlineBookingUntilLocal" IS NULL
    )
    OR
    (
        "proposedIsOpen" = TRUE
        AND "proposedOpensAtLocal" IS NOT NULL
        AND "proposedClosesAtLocal" IS NOT NULL
        AND "proposedOpensAtLocal" < "proposedClosesAtLocal"
        AND (
            "proposedMaximumOnlineBookingUntilLocal" IS NULL
            OR (
                "proposedMaximumOnlineBookingUntilLocal" >= "proposedOpensAtLocal"
                AND "proposedMaximumOnlineBookingUntilLocal" <= "proposedClosesAtLocal"
            )
        )
    )
);