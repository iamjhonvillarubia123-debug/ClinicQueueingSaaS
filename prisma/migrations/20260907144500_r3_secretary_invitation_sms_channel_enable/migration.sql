-- R3 Secretary invitation channel alignment.
-- Product Owner decision: Doctor and Secretary accounts may use either email or
-- Philippine mobile as the primary verified login identifier, and Secretary
-- invitations must work through that verified account channel. Existing
-- Secretary lookup therefore remains dual-identifier and invitation delivery
-- follows the Secretary account's verified primary identifier.
--
-- This migration broadens SECRETARY_INVITATION from EMAIL-only to EMAIL or SMS.
-- Other notification channel/type rules remain unchanged.

ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT IF EXISTS "NotificationOutbox_channel_type_check";

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_channel_type_check"
  CHECK (
    (
      "notificationType" IN (
        'BOOKING_CONFIRMATION',
        'APPOINTMENT_CANCELLATION',
        'CLINIC_DAY_CANCELLATION',
        'SCHEDULED_REMINDER',
        'OTP_VERIFICATION'
      )
      AND "channel" = 'SMS'
    )
    OR (
      "notificationType" IN (
        'SECURITY_NOTIFICATION',
        'SECRETARY_INVITATION'
      )
      AND "channel" IN ('SMS', 'EMAIL')
    )
    OR (
      "notificationType" IN (
        'PASSWORD_RESET',
        'DOCTOR_EMAIL_VERIFICATION',
        'FINANCIAL_ACCESS_VERIFICATION',
        'SUBSCRIPTION_GRACE_ENTERED',
        'SUBSCRIPTION_PAYMENT_SUCCEEDED',
        'SUBSCRIPTION_SUSPENDED',
        'SUBSCRIPTION_RESTORED',
        'REFUND_REQUEST_SUBMITTED',
        'REFUND_COMPLETED',
        'REFUND_FAILED',
        'COMPLIANCE_SUSPENSION_IMPOSED',
        'COMPLIANCE_SUSPENSION_LIFTED'
      )
      AND "channel" = 'EMAIL'
    )
  );
