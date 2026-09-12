-- R3 account-mobile OTP parent-constraint reconciliation.
-- Preserve the existing centralized OTP parent rules and add the account
-- mobile-verification purpose introduced by 20260906183000_r3_dual_account_identity.

ALTER TABLE "OtpVerification"
  DROP CONSTRAINT "OtpVerification_purpose_parent_check";

ALTER TABLE "OtpVerification"
  ADD CONSTRAINT "OtpVerification_purpose_parent_check"
  CHECK (
    (
      "purpose" = 'BOOKING'
      AND "bookingDraftId" IS NOT NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "userId" IS NULL
    )
    OR
    (
      "purpose" = 'APPOINTMENT_RECOVERY'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NOT NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "userId" IS NULL
    )
    OR
    (
      "purpose" = 'BOOKING_GROUP_RECOVERY'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NOT NULL
      AND "userId" IS NULL
    )
    OR
    (
      "purpose" = 'ACCOUNT_MOBILE_VERIFICATION'
      AND "bookingDraftId" IS NULL
      AND "bookingRecoveryAttemptId" IS NULL
      AND "bookingGroupRecoveryAttemptId" IS NULL
      AND "userId" IS NOT NULL
    )
  );
