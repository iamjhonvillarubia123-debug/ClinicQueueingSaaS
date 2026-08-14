-- M1S4B QUEUE IDENTITY / ORDERING FOUNDATION
--
-- Installs ClinicDay runtime state, Serving Order persistence/classification,
-- and stable QueueCounter / Appointment integrity backstops.
--
-- servingOrderKey uses NUMERIC(38,18): 20 integer digits and 18 fractional
-- digits. This is deliberately high precision for midpoint insertion while
-- remaining compatible with Prisma Decimal. Queue algorithms/rebalancing are
-- implemented later under the approved queue-scope transaction lock.

CREATE TYPE "WaitingPlacementType" AS ENUM (
  'ORDINARY',
  'RETURN_TO_QUEUE',
  'IM_HERE',
  'STAFF_REINSERT'
);

CREATE TYPE "ClinicDayStatus" AS ENUM (
  'NOT_STARTED',
  'DELAYED',
  'STARTED',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE "ClinicDayCancellationReason" AS ENUM (
  'DOCTOR_UNAVAILABLE',
  'MEDICAL_EMERGENCY',
  'PERSONAL_EMERGENCY',
  'SCHEDULE_CONFLICT',
  'CLINIC_UNAVAILABLE',
  'OTHER'
);

ALTER TABLE "Appointment"
  ADD COLUMN "servingOrderKey" NUMERIC(38,18),
  ADD COLUMN "waitingPlacementType" "WaitingPlacementType";

-- A queue participant is either actively WAITING with both placement fields,
-- or outside WAITING with both fields cleared. Queue commands mutate these
-- three pieces of state atomically.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_waiting_order_shape_check"
  CHECK (
    (
      "status" = 'WAITING'
      AND "servingOrderKey" IS NOT NULL
      AND "waitingPlacementType" IS NOT NULL
    )
    OR
    (
      "status" <> 'WAITING'
      AND "servingOrderKey" IS NULL
      AND "waitingPlacementType" IS NULL
    )
  );

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_queueNumber_positive_check"
  CHECK ("queueNumber" > 0);

-- No two active WAITING Appointments may occupy the same authoritative
-- Serving Order key in one PracticeLocation + Service Date queue scope.
CREATE UNIQUE INDEX "Appointment_active_servingOrderKey_key"
  ON "Appointment"("practiceLocationId", "serviceDate", "servingOrderKey")
  WHERE "status" = 'WAITING' AND "servingOrderKey" IS NOT NULL;

CREATE INDEX "Appointment_queue_scope_order_idx"
  ON "Appointment"("practiceLocationId", "serviceDate", "servingOrderKey");

ALTER TABLE "QueueCounter"
  ADD CONSTRAINT "QueueCounter_lastAllocatedNumber_nonnegative_check"
  CHECK ("lastAllocatedNumber" >= 0);

CREATE TABLE "ClinicDay" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "status" "ClinicDayStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "openingOverrideAt" TIMESTAMP(3) WITH TIME ZONE,
  "delayedOpeningDeclaredAt" TIMESTAMP(3) WITH TIME ZONE,
  "maximumOnlineBookingUntilAt" TIMESTAMP(3) WITH TIME ZONE,
  "operatingPracticeStaffId" TEXT,
  "startedAt" TIMESTAMP(3) WITH TIME ZONE,
  "closedAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledByUserId" TEXT,
  "cancellationReason" "ClinicDayCancellationReason",
  "cancellationNote" VARCHAR(500),
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "ClinicDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicDay_practiceLocationId_serviceDate_key"
  ON "ClinicDay"("practiceLocationId", "serviceDate");

CREATE INDEX "ClinicDay_status_serviceDate_idx"
  ON "ClinicDay"("status", "serviceDate");

CREATE INDEX "ClinicDay_operatingPracticeStaffId_serviceDate_idx"
  ON "ClinicDay"("operatingPracticeStaffId", "serviceDate");

ALTER TABLE "ClinicDay"
  ADD CONSTRAINT "ClinicDay_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicDay"
  ADD CONSTRAINT "ClinicDay_operatingPracticeStaffId_fkey"
  FOREIGN KEY ("operatingPracticeStaffId") REFERENCES "PracticeStaff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicDay"
  ADD CONSTRAINT "ClinicDay_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stable same-row lifecycle shapes. Cross-table authority/location matching
-- remains transaction-level backend validation.
ALTER TABLE "ClinicDay"
  ADD CONSTRAINT "ClinicDay_status_shape_check"
  CHECK (
    (
      "status" = 'NOT_STARTED'
      AND "startedAt" IS NULL
      AND "closedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByUserId" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancellationNote" IS NULL
    )
    OR
    (
      "status" = 'DELAYED'
      AND "startedAt" IS NULL
      AND "delayedOpeningDeclaredAt" IS NOT NULL
      AND "openingOverrideAt" IS NOT NULL
      AND "closedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByUserId" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancellationNote" IS NULL
    )
    OR
    (
      "status" = 'STARTED'
      AND "startedAt" IS NOT NULL
      AND "closedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByUserId" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancellationNote" IS NULL
    )
    OR
    (
      "status" = 'CLOSED'
      AND "startedAt" IS NOT NULL
      AND "closedAt" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND "cancelledByUserId" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancellationNote" IS NULL
    )
    OR
    (
      "status" = 'CANCELLED'
      AND "closedAt" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND "cancelledByUserId" IS NOT NULL
      AND "cancellationReason" IS NOT NULL
      AND (
        "cancellationReason" <> 'OTHER'
        OR NULLIF(BTRIM("cancellationNote"), '') IS NOT NULL
      )
    )
  );

ALTER TABLE "ClinicDay"
  ADD CONSTRAINT "ClinicDay_timestamp_order_check"
  CHECK (
    ("startedAt" IS NULL OR "startedAt" >= "createdAt")
    AND ("closedAt" IS NULL OR ("startedAt" IS NOT NULL AND "closedAt" >= "startedAt"))
    AND ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt")
    AND ("delayedOpeningDeclaredAt" IS NULL OR "delayedOpeningDeclaredAt" >= "createdAt")
  );
