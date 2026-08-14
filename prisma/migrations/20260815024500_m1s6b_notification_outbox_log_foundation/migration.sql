-- M1S6B NOTIFICATION OUTBOX / LOG FOUNDATION
--
-- Replaces the superseded direct NotificationLog / FollowUpRecommendation
-- architecture with:
--
--   source workflow -> NotificationOutbox -> NotificationLog attempts
--
-- SAFETY:
-- The legacy tables cannot be transformed losslessly into the canonical
-- logical-intent/attempt model without reviewed business mapping. Abort if
-- development rows exist rather than silently discard them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "NotificationLog" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "FollowUpRecommendation" LIMIT 1) THEN
    RAISE EXCEPTION
      'M1S6B requires empty legacy NotificationLog/FollowUpRecommendation tables. Existing rows require reviewed migration handling; no destructive conversion was performed.';
  END IF;
END $$;

DROP TABLE "NotificationLog";
DROP TABLE "FollowUpRecommendation";

DROP TYPE "NotificationStatus";
DROP TYPE "FollowUpRecommendationStatus";
DROP TYPE "NotificationType";
DROP TYPE "NotificationChannel";

CREATE TYPE "NotificationOutboxStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "NotificationChannel" AS ENUM (
  'SMS',
  'EMAIL'
);

CREATE TYPE "NotificationType" AS ENUM (
  'BOOKING_CONFIRMATION',
  'APPOINTMENT_CANCELLATION',
  'CLINIC_DAY_CANCELLATION',
  'SCHEDULED_REMINDER',
  'SECURITY_NOTIFICATION',
  'OTP_VERIFICATION',
  'SECRETARY_INVITATION',
  'PASSWORD_RESET',
  'DOCTOR_EMAIL_VERIFICATION'
);

CREATE TYPE "NotificationAttemptOutcome" AS ENUM (
  'SUCCESS',
  'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE',
  'UNCERTAIN'
);

CREATE TABLE "NotificationOutbox" (
  "id" TEXT NOT NULL,
  "deliveryIdentityKey" VARCHAR(64) NOT NULL,
  "notificationType" "NotificationType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
  "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "practiceLocationId" TEXT,
  "appointmentId" TEXT,
  "scheduledReminderId" TEXT,
  "commandIdempotencyId" TEXT,
  "otpVerificationId" TEXT,
  "secretaryInvitationId" TEXT,
  "passwordResetId" TEXT,
  "emailVerificationId" TEXT,
  "recipientMobileEncrypted" TEXT,
  "recipientEmailEncrypted" TEXT,
  "messageBodyEncrypted" TEXT,
  "providerIdempotencyKey" VARCHAR(128) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processingStartedAt" TIMESTAMP(3) WITH TIME ZONE,
  "leaseExpiresAt" TIMESTAMP(3) WITH TIME ZONE,
  "processingWorkerId" VARCHAR(100),
  "nextAttemptAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "sentAt" TIMESTAMP(3) WITH TIME ZONE,
  "failedAt" TIMESTAMP(3) WITH TIME ZONE,
  "cancelledAt" TIMESTAMP(3) WITH TIME ZONE,
  "protectedPayloadPurgedAt" TIMESTAMP(3) WITH TIME ZONE,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutbox_deliveryIdentityKey_key"
  ON "NotificationOutbox"("deliveryIdentityKey");

CREATE UNIQUE INDEX "NotificationOutbox_scheduledReminderId_key"
  ON "NotificationOutbox"("scheduledReminderId");

CREATE UNIQUE INDEX "NotificationOutbox_otpVerificationId_key"
  ON "NotificationOutbox"("otpVerificationId");

CREATE UNIQUE INDEX "NotificationOutbox_secretaryInvitationId_key"
  ON "NotificationOutbox"("secretaryInvitationId");

CREATE UNIQUE INDEX "NotificationOutbox_passwordResetId_key"
  ON "NotificationOutbox"("passwordResetId");

CREATE UNIQUE INDEX "NotificationOutbox_emailVerificationId_key"
  ON "NotificationOutbox"("emailVerificationId");

CREATE INDEX "NotificationOutbox_status_nextAttempt_idx"
  ON "NotificationOutbox"("status", "nextAttemptAt");

CREATE INDEX "NotificationOutbox_status_lease_idx"
  ON "NotificationOutbox"("status", "leaseExpiresAt");

CREATE INDEX "NotificationOutbox_location_created_idx"
  ON "NotificationOutbox"("practiceLocationId", "createdAt");

CREATE INDEX "NotificationOutbox_appointment_idx"
  ON "NotificationOutbox"("appointmentId");

CREATE INDEX "NotificationOutbox_command_idx"
  ON "NotificationOutbox"("commandIdempotencyId");

CREATE INDEX "NotificationOutbox_expires_idx"
  ON "NotificationOutbox"("expiresAt");

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 6: Appointment correlation must not block final physical erasure.
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_scheduledReminderId_fkey"
  FOREIGN KEY ("scheduledReminderId") REFERENCES "ScheduledReminder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_otpVerificationId_fkey"
  FOREIGN KEY ("otpVerificationId") REFERENCES "OtpVerification"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_delivery_identity_shape_check"
  CHECK (
    "deliveryIdentityKey" ~ '^[0-9a-f]{64}$'
    AND NULLIF(BTRIM("providerIdempotencyKey"), '') IS NOT NULL
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_attempt_count_check"
  CHECK ("attemptCount" >= 0);

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_processing_shape_check"
  CHECK (
    "status" <> 'PROCESSING'
    OR (
      "processingStartedAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > "processingStartedAt"
      AND NULLIF(BTRIM("processingWorkerId"), '') IS NOT NULL
    )
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_terminal_shape_check"
  CHECK (
    (
      "status" IN ('PENDING', 'PROCESSING')
      AND "sentAt" IS NULL
      AND "failedAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'SENT'
      AND "sentAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL
      AND "sentAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "cancelledAt" IS NOT NULL
      AND "sentAt" IS NULL
      AND "failedAt" IS NULL
    )
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_payload_cleanup_check"
  CHECK (
    "protectedPayloadPurgedAt" IS NULL
    OR (
      "recipientMobileEncrypted" IS NULL
      AND "recipientEmailEncrypted" IS NULL
      AND "messageBodyEncrypted" IS NULL
    )
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_source_type_check"
  CHECK (
    ("notificationType" <> 'SCHEDULED_REMINDER' OR "scheduledReminderId" IS NOT NULL)
    AND ("scheduledReminderId" IS NULL OR "notificationType" = 'SCHEDULED_REMINDER')
    AND ("notificationType" <> 'OTP_VERIFICATION' OR "otpVerificationId" IS NOT NULL)
    AND ("otpVerificationId" IS NULL OR "notificationType" = 'OTP_VERIFICATION')
    AND ("notificationType" <> 'SECRETARY_INVITATION' OR "secretaryInvitationId" IS NOT NULL)
    AND ("secretaryInvitationId" IS NULL OR "notificationType" = 'SECRETARY_INVITATION')
    AND ("notificationType" <> 'PASSWORD_RESET' OR "passwordResetId" IS NOT NULL)
    AND ("passwordResetId" IS NULL OR "notificationType" = 'PASSWORD_RESET')
    AND ("notificationType" <> 'DOCTOR_EMAIL_VERIFICATION' OR "emailVerificationId" IS NOT NULL)
    AND ("emailVerificationId" IS NULL OR "notificationType" = 'DOCTOR_EMAIL_VERIFICATION')
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_practice_location_scope_check"
  CHECK (
    (
      "notificationType" IN (
        'PASSWORD_RESET',
        'DOCTOR_EMAIL_VERIFICATION'
      )
      AND "practiceLocationId" IS NULL
    )
    OR (
      "notificationType" IN (
        'BOOKING_CONFIRMATION',
        'APPOINTMENT_CANCELLATION',
        'CLINIC_DAY_CANCELLATION',
        'SCHEDULED_REMINDER',
        'SECURITY_NOTIFICATION',
        'OTP_VERIFICATION',
        'SECRETARY_INVITATION'
      )
      AND "practiceLocationId" IS NOT NULL
    )
  );

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_channel_type_check"
  CHECK (
    (
      "notificationType" IN (
        'BOOKING_CONFIRMATION',
        'APPOINTMENT_CANCELLATION',
        'CLINIC_DAY_CANCELLATION',
        'SCHEDULED_REMINDER',
        'SECURITY_NOTIFICATION',
        'OTP_VERIFICATION'
      )
      AND "channel" = 'SMS'
    )
    OR (
      "notificationType" IN (
        'SECRETARY_INVITATION',
        'PASSWORD_RESET',
        'DOCTOR_EMAIL_VERIFICATION'
      )
      AND "channel" = 'EMAIL'
    )
  );

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "notificationOutboxId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "notificationType" "NotificationType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "outcome" "NotificationAttemptOutcome" NOT NULL,
  "providerName" VARCHAR(100),
  "providerReference" VARCHAR(200),
  "providerStatus" VARCHAR(100),
  "providerErrorCode" VARCHAR(100),
  "failureDetailSanitized" VARCHAR(500),
  "retryRecommended" BOOLEAN NOT NULL,
  "providerIdempotencyKeyUsed" VARCHAR(128),
  "submittedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "resolvedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLog_outbox_attempt_key"
  ON "NotificationLog"("notificationOutboxId", "attemptNumber");

CREATE INDEX "NotificationLog_outcome_created_idx"
  ON "NotificationLog"("outcome", "createdAt");

CREATE INDEX "NotificationLog_provider_reference_idx"
  ON "NotificationLog"("providerName", "providerReference");

CREATE INDEX "NotificationLog_expires_idx"
  ON "NotificationLog"("expiresAt");

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_notificationOutboxId_fkey"
  FOREIGN KEY ("notificationOutboxId") REFERENCES "NotificationOutbox"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_attempt_number_check"
  CHECK ("attemptNumber" > 0);

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_timestamp_check"
  CHECK (
    ("resolvedAt" IS NULL OR "resolvedAt" >= "submittedAt")
    AND "expiresAt" > "createdAt"
  );

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_retry_outcome_check"
  CHECK (
    ("outcome" = 'SUCCESS' AND "retryRecommended" = FALSE)
    OR ("outcome" = 'PERMANENT_FAILURE' AND "retryRecommended" = FALSE)
    OR ("outcome" = 'RETRYABLE_FAILURE' AND "retryRecommended" = TRUE)
    OR ("outcome" = 'UNCERTAIN')
  );