-- M7S1 START CLINIC CONTRACT
-- Adds the missing durable command/event identities required by the
-- approved START CLINIC workflow. This does not change product behavior;
-- it makes the existing retry/audit rules representable in the database.

ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'START_CLINIC' BEFORE 'NEXT_PATIENT';
ALTER TYPE "QueueEventType" ADD VALUE IF NOT EXISTS 'START_CLINIC' BEFORE 'NEXT_PATIENT';

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_start_clinic_scope_check"
  CHECK (
    "commandType" <> 'START_CLINIC'
    OR (
      "practiceLocationId" IS NOT NULL
      AND "serviceDate" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "appointmentId" IS NULL
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "accountUserId" IS NULL
      AND "bookingGroupId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "doctorFinancialAccountId" IS NULL
      AND "resultAppointmentId" IS NULL
      AND "resultQueueEventId" IS NOT NULL
      AND "resultBookingGroupId" IS NULL
      AND "resultBookingGroupAccessTokenId" IS NULL
      AND "resultAdministrativeAccountActionId" IS NULL
    )
  );
