ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT "NotificationOutbox_channel_type_check";

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
    OR (
      "notificationType" = 'SECURITY_NOTIFICATION'
      AND "channel" = 'EMAIL'
      AND "commandIdempotencyId" IS NOT NULL
    )
  );