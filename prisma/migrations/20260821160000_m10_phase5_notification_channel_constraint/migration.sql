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
      "notificationType" = 'SECURITY_NOTIFICATION'
      AND "channel" IN ('SMS', 'EMAIL')
    )
    OR (
      "notificationType" IN (
        'SECRETARY_INVITATION',
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
