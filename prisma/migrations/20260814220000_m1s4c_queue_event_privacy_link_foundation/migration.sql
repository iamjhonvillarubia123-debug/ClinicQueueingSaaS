-- M1S4C QUEUE EVENT / PRIVACY LINK FOUNDATION
--
-- Reconciles QueueEvent to the approved append-only Version 1 history model:
-- - deterministic queue-scope BIGINT chronology;
-- - generic append-only UNDO via reversesQueueEventId;
-- - no mutable isUndoable / undoneAt fields;
-- - Appointment identity correlation moved to deletable QueueEventAppointmentLink;
-- - Serving Order / waiting-placement / terminal / self-service evidence retained
--   as non-identity operational audit fields.
--
-- Existing QueueEvent rows are migrated losslessly into PRIMARY/SECONDARY link
-- rows before direct Appointment foreign keys are removed.

CREATE TYPE "QueueEventAppointmentLinkRole" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "ClinicClosureDisposition" AS ENUM ('COMPLETED', 'OUT_FOR_PROCEDURE');

-- Replace the obsolete command-specific UNDO_NEXT_PATIENT enum value with the
-- canonical generic UNDO value while preserving any existing event rows.
ALTER TYPE "QueueEventType" RENAME TO "QueueEventType_old";
CREATE TYPE "QueueEventType" AS ENUM (
  'NEXT_PATIENT',
  'SELF_SERVICE_REINSERTION',
  'STAFF_REINSERTION',
  'OUT_FOR_PROCEDURE',
  'UNDO',
  'APPOINTMENT_CANCELLED',
  'QUEUE_CLOSED'
);

ALTER TABLE "QueueEvent"
  ALTER COLUMN "type" TYPE "QueueEventType"
  USING (
    CASE
      WHEN "type"::text = 'UNDO_NEXT_PATIENT' THEN 'UNDO'
      ELSE "type"::text
    END
  )::"QueueEventType";

DROP TYPE "QueueEventType_old";

ALTER TABLE "QueueEvent"
  ADD COLUMN "queueEventSequence" BIGINT,
  ADD COLUMN "previousPrimaryOrderKey" NUMERIC(38,18),
  ADD COLUMN "newPrimaryOrderKey" NUMERIC(38,18),
  ADD COLUMN "previousSecondaryOrderKey" NUMERIC(38,18),
  ADD COLUMN "newSecondaryOrderKey" NUMERIC(38,18),
  ADD COLUMN "previousPrimaryWaitingPlacementType" "WaitingPlacementType",
  ADD COLUMN "newPrimaryWaitingPlacementType" "WaitingPlacementType",
  ADD COLUMN "previousSecondaryWaitingPlacementType" "WaitingPlacementType",
  ADD COLUMN "newSecondaryWaitingPlacementType" "WaitingPlacementType",
  ADD COLUMN "previousPrimaryTerminalAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "newPrimaryTerminalAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "previousSecondaryTerminalAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "newSecondaryTerminalAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "previousPrimarySelfServiceReinsertedAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "newPrimarySelfServiceReinsertedAt" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "clinicClosureDisposition" "ClinicClosureDisposition";

-- Backfill deterministic chronology for any pre-existing development events.
-- Future business transactions allocate this value under the approved queue-
-- scope advisory lock; this migration uses committed createdAt/id order only to
-- give legacy rows a deterministic one-time sequence during reconstruction.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "practiceLocationId", "serviceDate"
      ORDER BY "createdAt", "id"
    )::BIGINT AS seq
  FROM "QueueEvent"
)
UPDATE "QueueEvent" q
SET "queueEventSequence" = ranked.seq
FROM ranked
WHERE ranked."id" = q."id";

ALTER TABLE "QueueEvent"
  ALTER COLUMN "queueEventSequence" SET NOT NULL;

CREATE UNIQUE INDEX "QueueEvent_practiceLocationId_serviceDate_queueEventSequence_key"
  ON "QueueEvent"("practiceLocationId", "serviceDate", "queueEventSequence");

CREATE INDEX "QueueEvent_practiceLocationId_serviceDate_queueEventSequence_idx"
  ON "QueueEvent"("practiceLocationId", "serviceDate", "queueEventSequence");

-- Build the temporary, privacy-deletable Appointment correlation table.
CREATE TABLE "QueueEventAppointmentLink" (
  "id" TEXT NOT NULL,
  "queueEventId" TEXT NOT NULL,
  "role" "QueueEventAppointmentLinkRole" NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QueueEventAppointmentLink_pkey" PRIMARY KEY ("id")
);

INSERT INTO "QueueEventAppointmentLink" (
  "id", "queueEventId", "role", "appointmentId", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  'PRIMARY'::"QueueEventAppointmentLinkRole",
  "primaryAppointmentId",
  "createdAt"
FROM "QueueEvent";

INSERT INTO "QueueEventAppointmentLink" (
  "id", "queueEventId", "role", "appointmentId", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  'SECONDARY'::"QueueEventAppointmentLinkRole",
  "secondaryAppointmentId",
  "createdAt"
FROM "QueueEvent"
WHERE "secondaryAppointmentId" IS NOT NULL;

CREATE UNIQUE INDEX "QueueEventAppointmentLink_queueEventId_role_key"
  ON "QueueEventAppointmentLink"("queueEventId", "role");

CREATE UNIQUE INDEX "QueueEventAppointmentLink_queueEventId_appointmentId_key"
  ON "QueueEventAppointmentLink"("queueEventId", "appointmentId");

CREATE INDEX "QueueEventAppointmentLink_appointmentId_createdAt_idx"
  ON "QueueEventAppointmentLink"("appointmentId", "createdAt");

CREATE INDEX "QueueEventAppointmentLink_queueEventId_idx"
  ON "QueueEventAppointmentLink"("queueEventId");

ALTER TABLE "QueueEventAppointmentLink"
  ADD CONSTRAINT "QueueEventAppointmentLink_queueEventId_fkey"
  FOREIGN KEY ("queueEventId") REFERENCES "QueueEvent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueEventAppointmentLink"
  ADD CONSTRAINT "QueueEventAppointmentLink_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove the superseded direct Appointment correlation from immutable core.
ALTER TABLE "QueueEvent" DROP CONSTRAINT "QueueEvent_primaryAppointmentId_fkey";
ALTER TABLE "QueueEvent" DROP CONSTRAINT "QueueEvent_secondaryAppointmentId_fkey";
DROP INDEX "QueueEvent_primaryAppointmentId_createdAt_idx";
DROP INDEX "QueueEvent_secondaryAppointmentId_idx";

ALTER TABLE "QueueEvent"
  DROP COLUMN "primaryAppointmentId",
  DROP COLUMN "secondaryAppointmentId";

-- Reconcile append-only Undo vocabulary and remove mutable original-event state.
ALTER TABLE "QueueEvent" DROP CONSTRAINT "QueueEvent_reversedEventId_fkey";
DROP INDEX "QueueEvent_reversedEventId_key";
DROP INDEX "QueueEvent_isUndoable_practiceLocationId_serviceDate_idx";

ALTER TABLE "QueueEvent"
  RENAME COLUMN "reversedEventId" TO "reversesQueueEventId";

ALTER TABLE "QueueEvent"
  DROP COLUMN "isUndoable",
  DROP COLUMN "undoneAt";

CREATE UNIQUE INDEX "QueueEvent_reversesQueueEventId_key"
  ON "QueueEvent"("reversesQueueEventId");

ALTER TABLE "QueueEvent"
  ADD CONSTRAINT "QueueEvent_reversesQueueEventId_fkey"
  FOREIGN KEY ("reversesQueueEventId") REFERENCES "QueueEvent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueEvent"
  ADD CONSTRAINT "QueueEvent_actor_shape_check"
  CHECK (
    ("actorType" = 'USER' AND "actorUserId" IS NOT NULL)
    OR
    ("actorType" IN ('PATIENT', 'SYSTEM') AND "actorUserId" IS NULL)
  );

ALTER TABLE "QueueEvent"
  ADD CONSTRAINT "QueueEvent_undo_reference_shape_check"
  CHECK (
    ("type" = 'UNDO' AND "reversesQueueEventId" IS NOT NULL)
    OR
    ("type" <> 'UNDO' AND "reversesQueueEventId" IS NULL)
  );

ALTER TABLE "QueueEvent"
  ADD CONSTRAINT "QueueEvent_sequence_positive_check"
  CHECK ("queueEventSequence" > 0);
