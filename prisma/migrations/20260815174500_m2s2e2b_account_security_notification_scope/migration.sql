ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT "NotificationOutbox_practice_location_scope_check";

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_practice_location_scope_check"
  CHECK (
    (
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
      AND "practiceLocationId" IS NULL
    )
    OR (
      "notificationType" = 'SECURITY_NOTIFICATION'
      AND "practiceLocationId" IS NULL
      AND "commandIdempotencyId" IS NOT NULL
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