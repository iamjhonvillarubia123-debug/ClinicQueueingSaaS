-- CreateEnum
CREATE TYPE "DoctorCalendarRecurrenceType" AS ENUM ('SINGLE_DATE', 'DATE_RANGE', 'DAILY', 'WEEKLY', 'MONTHLY_DATE');

-- CreateEnum
CREATE TYPE "DoctorCalendarRuleStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "DoctorCalendarLabelType" AS ENUM ('SEMINAR', 'HOLIDAY', 'PERSONAL', 'CUSTOM');

-- AlterTable
ALTER TABLE "DoctorAccountSettings" ADD COLUMN     "noClinicOnRegularHolidays" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DoctorCalendarRule" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "recurrenceType" "DoctorCalendarRecurrenceType" NOT NULL,
    "status" "DoctorCalendarRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "timeZone" VARCHAR(100) NOT NULL,
    "isWholeDay" BOOLEAN NOT NULL DEFAULT true,
    "startsAtLocal" TIME(0),
    "endsAtLocal" TIME(0),
    "monthlyDayOfMonth" INTEGER,
    "labelType" "DoctorCalendarLabelType" NOT NULL DEFAULT 'PERSONAL',
    "customLabel" VARCHAR(50),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "DoctorCalendarRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorCalendarRuleWeekday" (
    "id" TEXT NOT NULL,
    "doctorCalendarRuleId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,

    CONSTRAINT "DoctorCalendarRuleWeekday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorCalendarOccurrenceOverride" (
    "id" TEXT NOT NULL,
    "doctorCalendarRuleId" TEXT NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorCalendarOccurrenceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorCalendarRule_doctorProfileId_status_idx" ON "DoctorCalendarRule"("doctorProfileId", "status");

-- CreateIndex
CREATE INDEX "DoctorCalendarRule_doctorProfileId_startDate_endDate_idx" ON "DoctorCalendarRule"("doctorProfileId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "DoctorCalendarRule_recurrenceType_status_idx" ON "DoctorCalendarRule"("recurrenceType", "status");

-- CreateIndex
CREATE INDEX "DoctorCalendarRuleWeekday_doctorCalendarRuleId_idx" ON "DoctorCalendarRuleWeekday"("doctorCalendarRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorCalendarRuleWeekday_doctorCalendarRuleId_weekday_key" ON "DoctorCalendarRuleWeekday"("doctorCalendarRuleId", "weekday");

-- CreateIndex
CREATE INDEX "DoctorCalendarOccurrenceOverride_doctorCalendarRuleId_occur_idx" ON "DoctorCalendarOccurrenceOverride"("doctorCalendarRuleId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorCalendarOccurrenceOverride_doctorCalendarRuleId_occur_key" ON "DoctorCalendarOccurrenceOverride"("doctorCalendarRuleId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "DoctorCalendarRule" ADD CONSTRAINT "DoctorCalendarRule_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCalendarRuleWeekday" ADD CONSTRAINT "DoctorCalendarRuleWeekday_doctorCalendarRuleId_fkey" FOREIGN KEY ("doctorCalendarRuleId") REFERENCES "DoctorCalendarRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCalendarOccurrenceOverride" ADD CONSTRAINT "DoctorCalendarOccurrenceOverride_doctorCalendarRuleId_fkey" FOREIGN KEY ("doctorCalendarRuleId") REFERENCES "DoctorCalendarRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S2D2 MANUAL POSTGRESQL CONSTRAINTS

-- Whole-day blocks have no local clock interval.
-- Partial-day blocks require one valid same-day interval.
ALTER TABLE "DoctorCalendarRule"
ADD CONSTRAINT "DoctorCalendarRule_time_shape_check"
CHECK (
    (
        "isWholeDay" = TRUE
        AND "startsAtLocal" IS NULL
        AND "endsAtLocal" IS NULL
    )
    OR
    (
        "isWholeDay" = FALSE
        AND "startsAtLocal" IS NOT NULL
        AND "endsAtLocal" IS NOT NULL
        AND "startsAtLocal" < "endsAtLocal"
    )
);

-- Recurrence/date-field shape.
-- SINGLE_DATE owns only startDate.
-- DATE_RANGE requires an inclusive non-reversed endDate.
-- DAILY / WEEKLY / MONTHLY_DATE may be open-ended; when endDate is present
-- it must not precede startDate.
ALTER TABLE "DoctorCalendarRule"
ADD CONSTRAINT "DoctorCalendarRule_recurrence_date_shape_check"
CHECK (
    (
        "recurrenceType" = 'SINGLE_DATE'::"DoctorCalendarRecurrenceType"
        AND "endDate" IS NULL
    )
    OR
    (
        "recurrenceType" = 'DATE_RANGE'::"DoctorCalendarRecurrenceType"
        AND "endDate" IS NOT NULL
        AND "endDate" >= "startDate"
    )
    OR
    (
        "recurrenceType" IN (
            'DAILY'::"DoctorCalendarRecurrenceType",
            'WEEKLY'::"DoctorCalendarRecurrenceType",
            'MONTHLY_DATE'::"DoctorCalendarRecurrenceType"
        )
        AND (
            "endDate" IS NULL
            OR "endDate" >= "startDate"
        )
    )
);

-- Monthly selected calendar date exists only for MONTHLY_DATE and is bounded
-- to the ordinary calendar-date domain. Month-specific validity is resolved
-- when concrete occurrences are generated.
ALTER TABLE "DoctorCalendarRule"
ADD CONSTRAINT "DoctorCalendarRule_monthly_day_shape_check"
CHECK (
    (
        "recurrenceType" = 'MONTHLY_DATE'::"DoctorCalendarRecurrenceType"
        AND "monthlyDayOfMonth" BETWEEN 1 AND 31
    )
    OR
    (
        "recurrenceType" <> 'MONTHLY_DATE'::"DoctorCalendarRecurrenceType"
        AND "monthlyDayOfMonth" IS NULL
    )
);

-- CUSTOM label requires meaningful custom text. Standard private labels do not
-- carry a separate custom label value.
ALTER TABLE "DoctorCalendarRule"
ADD CONSTRAINT "DoctorCalendarRule_label_shape_check"
CHECK (
    (
        "labelType" = 'CUSTOM'::"DoctorCalendarLabelType"
        AND "customLabel" IS NOT NULL
        AND length(btrim("customLabel")) > 0
    )
    OR
    (
        "labelType" <> 'CUSTOM'::"DoctorCalendarLabelType"
        AND "customLabel" IS NULL
    )
);

-- Retirement preserves history rather than deleting the rule.
ALTER TABLE "DoctorCalendarRule"
ADD CONSTRAINT "DoctorCalendarRule_status_shape_check"
CHECK (
    (
        "status" = 'ACTIVE'::"DoctorCalendarRuleStatus"
        AND "retiredAt" IS NULL
    )
    OR
    (
        "status" = 'RETIRED'::"DoctorCalendarRuleStatus"
        AND "retiredAt" IS NOT NULL
    )
);

-- Version 1 occurrence override semantics only permit a selected recurring
-- occurrence to be made available again.
ALTER TABLE "DoctorCalendarOccurrenceOverride"
ADD CONSTRAINT "DoctorCalendarOccurrenceOverride_available_check"
CHECK ("isAvailable" = TRUE);