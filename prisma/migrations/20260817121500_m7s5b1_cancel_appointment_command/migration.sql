-- M7S5B1 ordinary authenticated Appointment cancellation command.
-- The existing CommandIdempotency matrix predates this command and falls
-- through for new enum members, so this migration adds a dedicated exact
-- scope check without rewriting the historical matrix.

ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'CANCEL_APPOINTMENT';

ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_cancel_appointment_scope_check"
  CHECK (
    "commandType" <> 'CANCEL_APPOINTMENT'
    OR (
      "practiceLocationId" IS NOT NULL
      AND "serviceDate" IS NOT NULL
      AND "appointmentId" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "accountUserId" IS NULL
      AND "bookingGroupId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "doctorFinancialAccountId" IS NULL
      AND "resultAppointmentId" IS NOT NULL
      AND "resultQueueEventId" IS NOT NULL
      AND "resultBookingGroupId" IS NULL
      AND "resultBookingGroupAccessTokenId" IS NULL
      AND "resultAdministrativeAccountActionId" IS NULL
    )
  );
