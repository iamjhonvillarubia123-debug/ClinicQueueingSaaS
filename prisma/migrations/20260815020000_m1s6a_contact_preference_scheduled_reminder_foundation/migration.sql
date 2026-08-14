-- M1S6A CONTACT PREFERENCE / SCHEDULED REMINDER FOUNDATION
--
-- Establishes the canonical Appointment-scoped optional-reminder provenance
-- and independent ScheduledReminder snapshot/lifecycle.
--
-- Phase 6 final privacy shape:
--   ContactPreference.appointmentId -> nullable / ON DELETE SET NULL
--   ScheduledReminder.sourceAppointmentId -> nullable / ON DELETE SET NULL
--
-- Both links remain required by application validation at creation time.
-- NotificationOutbox/NotificationLog replacement follows in M1S6B.

CREATE TYPE "ScheduledReminderStatus" AS ENUM (
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'CANCELLED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "ScheduledReminderRecipientSource" AS ENUM (
  'APPOINTMENT_CONTACT',
  'BOOKING_GROUP_CONTROLLER',
  'STAFF_ENTERED'
);

ALTER TABLE "ContactPreference"
  DROP CONSTRAINT "ContactPreference_appointmentId_fkey";

ALTER TABLE "ContactPreference"
  ALTER COLUMN "appointmentId" DROP NOT NULL;

ALTER TABLE "ContactPreference"
  ADD CONSTRAINT "ContactPreference_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactPreference"
  ADD CONSTRAINT "ContactPreference_marketing_disabled_check"
  CHECK ("allowMarketingMessages" = FALSE);

ALTER TABLE "ContactPreference"
  ADD CONSTRAINT "ContactPreference_privacy_notice_nonblank_check"
  CHECK (NULLIF(BTRIM("privacyNoticeVersion"), '') IS NOT NULL);

ALTER TABLE "ContactPreference"
  ADD CONSTRAINT "ContactPreference_withdrawal_order_check"
  CHECK ("withdrawnAt" IS NULL OR "withdrawnAt" >= "acknowledgedAt");

CREATE TABLE "ScheduledReminder" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "sourceAppointmentId" TEXT,
  "contactPreferenceId" TEXT NOT NULL,
  "recipientSource" "ScheduledReminderRecipientSource" NOT NULL,
  "recipientMobileEncrypted" TEXT,
  "recipientMobileLastFour" VARCHAR(4),
  "status" "ScheduledReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledFor" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "messageBody" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "lastEditedByUserId" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledAt" TIMESTAMP(3) WITH TIME ZONE,
  "failedAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiredAt" TIMESTAMP(3) WITH TIME ZONE,
  "protectedDataClearedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_sourceAppointmentId_fkey"
  FOREIGN KEY ("sourceAppointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_contactPreferenceId_fkey"
  FOREIGN KEY ("contactPreferenceId") REFERENCES "ContactPreference"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_lastEditedByUserId_fkey"
  FOREIGN KEY ("lastEditedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_schedule_order_check"
  CHECK (
    "scheduledFor" > "createdAt"
    AND "expiresAt" > "scheduledFor"
  );

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_last_four_check"
  CHECK (
    "recipientMobileLastFour" IS NULL
    OR "recipientMobileLastFour" ~ '^[0-9]{4}$'
  );

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_terminal_shape_check"
  CHECK (
    (
      "status" IN ('SCHEDULED', 'PROCESSING')
      AND "sentAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "failedAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR (
      "status" = 'SENT'
      AND "sentAt" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND "failedAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "cancelledAt" IS NOT NULL
      AND "sentAt" IS NULL
      AND "failedAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL
      AND "sentAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "expiredAt" IS NOT NULL
      AND "sentAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "failedAt" IS NULL
    )
  );

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_active_payload_check"
  CHECK (
    "status" NOT IN ('SCHEDULED', 'PROCESSING')
    OR (
      "recipientMobileEncrypted" IS NOT NULL
      AND "recipientMobileLastFour" IS NOT NULL
      AND NULLIF(BTRIM("messageBody"), '') IS NOT NULL
      AND "protectedDataClearedAt" IS NULL
    )
  );

ALTER TABLE "ScheduledReminder"
  ADD CONSTRAINT "ScheduledReminder_protected_cleanup_check"
  CHECK (
    "protectedDataClearedAt" IS NULL
    OR (
      "status" IN ('SENT', 'CANCELLED', 'FAILED', 'EXPIRED')
      AND "recipientMobileEncrypted" IS NULL
      AND "recipientMobileLastFour" IS NULL
      AND "messageBody" IS NULL
    )
  );

CREATE INDEX "ScheduledReminder_location_status_due_idx"
  ON "ScheduledReminder"("practiceLocationId", "status", "scheduledFor");

CREATE INDEX "ScheduledReminder_status_due_idx"
  ON "ScheduledReminder"("status", "scheduledFor");

CREATE INDEX "ScheduledReminder_sourceAppointment_idx"
  ON "ScheduledReminder"("sourceAppointmentId");

CREATE INDEX "ScheduledReminder_contactPreference_idx"
  ON "ScheduledReminder"("contactPreferenceId");

CREATE INDEX "ScheduledReminder_createdBy_idx"
  ON "ScheduledReminder"("createdByUserId");

CREATE INDEX "ScheduledReminder_lastEditedBy_idx"
  ON "ScheduledReminder"("lastEditedByUserId");