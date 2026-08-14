-- M1S7A COMMAND IDEMPOTENCY FOUNDATION
--
-- Installs the committed-result-only CommandIdempotency record and
-- synchronizes already-available durable child correlations.
--
-- There is deliberately:
-- - no status field;
-- - no durable IN_PROGRESS / COMPLETED state machine;
-- - no BookingDraft foreign key;
-- - no raw request/response/credential payload.
--
-- Command-type scope matrix checks follow separately in M1S7B.

CREATE TYPE "CommandType" AS ENUM (
  'CONVERT_BOOKING_DRAFT',
  'CREATE_STAFF_APPOINTMENT',
  'NEXT_PATIENT',
  'SELF_SERVICE_REINSERTION',
  'RETURN_TO_QUEUE',
  'STAFF_REINSERTION',
  'UNDO',
  'CLOSE_CLINIC',
  'CANCEL_CLINIC_DAY',
  'COMPLETE_APPOINTMENT_RECOVERY',

  'DOCTOR_DISABLE_ACCOUNT',
  'DOCTOR_REACTIVATE_ACCOUNT',
  'DOCTOR_DELETE_ACCOUNT',
  'SECRETARY_DISABLE_ACCOUNT',
  'SECRETARY_REACTIVATE_ACCOUNT',
  'SECRETARY_DELETE_ACCOUNT',
  'SYSTEM_ADMIN_NORMAL_SUSPEND_DOCTOR',
  'SYSTEM_ADMIN_NORMAL_RESTORE_DOCTOR',
  'SYSTEM_ADMIN_EMERGENCY_SUSPEND_DOCTOR',
  'SYSTEM_ADMIN_EMERGENCY_RESTORE_DOCTOR',

  'MULTI_PERSON_BOOKING_CONFIRM',
  'BOOKING_GROUP_ADD_PERSON',
  'BOOKING_GROUP_CANCEL_MEMBER',
  'BOOKING_GROUP_RECOVERY_COMPLETE',

  'PRACTICE_LOCATION_ACTIVATE',
  'PRACTICE_LOCATION_DISABLE',
  'PRACTICE_LOCATION_REACTIVATE',
  'PRACTICE_LOCATION_DELETE',
  'PRACTICE_LOCATION_UPDATE_SETTINGS',
  'PRACTICE_LOCATION_APPROVE_SETTINGS_DRAFT',
  'PRACTICE_LOCATION_REJECT_SETTINGS_DRAFT',
  'PRACTICE_LOCATION_RETURN_SETTINGS_DRAFT',
  'PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY',
  'PRACTICE_LOCATION_REPLACE_REGULAR_SECRETARY',
  'PRACTICE_LOCATION_REMOVE_REGULAR_SECRETARY',
  'CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY',
  'CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY',
  'CLINIC_DAY_END_SUBSTITUTE_SECRETARY',
  'DOCTOR_DEFAULTS_APPLY',
  'DOCTOR_CALENDAR_UPDATE',

  'DOCTOR_PURCHASE_SUBSCRIPTION',
  'DOCTOR_REQUEST_REFUND',
  'SYSTEM_ADMIN_COMPLETE_REFUND',
  'SYSTEM_ADMIN_FAIL_REFUND',
  'DOCTOR_RECOVER_SUBSCRIPTION_CREDIT'
);

CREATE TABLE "CommandIdempotency" (
  "id" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(100) NOT NULL,
  "commandIdentityKey" VARCHAR(64) NOT NULL,
  "commandType" "CommandType" NOT NULL,
  "requestFingerprint" VARCHAR(64) NOT NULL,

  "practiceLocationId" TEXT,
  "serviceDate" DATE,
  "appointmentId" TEXT,
  "bookingDraftId" TEXT,
  "bookingRecoveryAttemptId" TEXT,
  "actorUserId" TEXT,
  "accountUserId" TEXT,

  "bookingGroupId" TEXT,
  "bookingGroupRecoveryAttemptId" TEXT,

  "doctorFinancialAccountId" TEXT,

  "resultAppointmentId" TEXT,
  "resultQueueEventId" TEXT,
  "resultBookingGroupId" TEXT,
  "resultBookingGroupAccessTokenId" TEXT,
  "resultAdministrativeAccountActionId" TEXT,

  "completedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "expiresAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommandIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommandIdempotency_commandIdentityKey_key"
  ON "CommandIdempotency"("commandIdentityKey");

CREATE INDEX "CommandIdempotency_expires_idx"
  ON "CommandIdempotency"("expiresAt");

CREATE INDEX "CommandIdempotency_location_date_idx"
  ON "CommandIdempotency"("practiceLocationId", "serviceDate");

CREATE INDEX "CommandIdempotency_appointment_idx"
  ON "CommandIdempotency"("appointmentId");

CREATE INDEX "CommandIdempotency_bookingDraft_idx"
  ON "CommandIdempotency"("bookingDraftId");

CREATE INDEX "CommandIdempotency_bookingRecovery_idx"
  ON "CommandIdempotency"("bookingRecoveryAttemptId");

CREATE INDEX "CommandIdempotency_actor_idx"
  ON "CommandIdempotency"("actorUserId");

CREATE INDEX "CommandIdempotency_account_idx"
  ON "CommandIdempotency"("accountUserId");

CREATE INDEX "CommandIdempotency_bookingGroup_idx"
  ON "CommandIdempotency"("bookingGroupId");

CREATE INDEX "CommandIdempotency_groupRecovery_idx"
  ON "CommandIdempotency"("bookingGroupRecoveryAttemptId");

CREATE INDEX "CommandIdempotency_financialAccount_idx"
  ON "CommandIdempotency"("doctorFinancialAccountId");

CREATE INDEX "CommandIdempotency_resultAppointment_idx"
  ON "CommandIdempotency"("resultAppointmentId");

CREATE INDEX "CommandIdempotency_resultQueueEvent_idx"
  ON "CommandIdempotency"("resultQueueEventId");

CREATE INDEX "CommandIdempotency_resultBookingGroup_idx"
  ON "CommandIdempotency"("resultBookingGroupId");

CREATE INDEX "CommandIdempotency_resultGroupToken_idx"
  ON "CommandIdempotency"("resultBookingGroupAccessTokenId");

CREATE INDEX "CommandIdempotency_resultAdminAction_idx"
  ON "CommandIdempotency"("resultAdministrativeAccountActionId");

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_practiceLocationId_fkey"
  FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 6 privacy: patient-correlating technical references must be unlinkable.
ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_bookingRecoveryAttemptId_fkey"
  FOREIGN KEY ("bookingRecoveryAttemptId") REFERENCES "BookingRecoveryAttempt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_accountUserId_fkey"
  FOREIGN KEY ("accountUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_bookingGroupId_fkey"
  FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_bookingGroupRecoveryAttemptId_fkey"
  FOREIGN KEY ("bookingGroupRecoveryAttemptId") REFERENCES "BookingGroupRecoveryAttempt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_resultAppointmentId_fkey"
  FOREIGN KEY ("resultAppointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_resultQueueEventId_fkey"
  FOREIGN KEY ("resultQueueEventId") REFERENCES "QueueEvent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_resultBookingGroupId_fkey"
  FOREIGN KEY ("resultBookingGroupId") REFERENCES "BookingGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_resultBookingGroupAccessTokenId_fkey"
  FOREIGN KEY ("resultBookingGroupAccessTokenId") REFERENCES "BookingGroupAccessToken"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_resultAdministrativeAccountActionId_fkey"
  FOREIGN KEY ("resultAdministrativeAccountActionId") REFERENCES "AdministrativeAccountAction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_identity_hash_shape_check"
  CHECK (
    "commandIdentityKey" ~ '^[0-9a-f]{64}$'
    AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
    AND NULLIF(BTRIM("idempotencyKey"), '') IS NOT NULL
  );

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_retention_check"
  CHECK (
    "completedAt" >= "createdAt"
    AND "expiresAt" = "completedAt" + INTERVAL '7 days'
  );

-- Synchronize durable child records to short-lived CommandIdempotency.
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationNotification"
  ADD CONSTRAINT "ApplicationNotification_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountPermanentClosureAudit"
  ADD CONSTRAINT "AccountPermanentClosureAudit_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- doctorFinancialAccountId remains a nullable scalar in Slice 7 because
-- DoctorFinancialAccount is created in Slice 8. Slice 8 synchronizes its FK.
-- bookingDraftId deliberately remains scalar-only with NO foreign key.