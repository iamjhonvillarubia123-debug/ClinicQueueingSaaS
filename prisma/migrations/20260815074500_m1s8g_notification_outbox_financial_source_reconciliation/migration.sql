-- M1S8G - NotificationOutbox financial/account durable source reconciliation.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCIAL_ACCESS_VERIFICATION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_GRACE_ENTERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PAYMENT_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_RESTORED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_REQUEST_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFUND_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_SUSPENSION_IMPOSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLIANCE_SUSPENSION_LIFTED';

ALTER TABLE "NotificationOutbox"
  ADD COLUMN "financialAccessChallengeId" TEXT,
  ADD COLUMN "subscriptionEntitlementEventId" TEXT,
  ADD COLUMN "subscriptionPurchaseId" TEXT,
  ADD COLUMN "refundRequestId" TEXT,
  ADD COLUMN "administrativeAccountActionId" TEXT;

CREATE UNIQUE INDEX "NotificationOutbox_financialAccessChallengeId_key"
  ON "NotificationOutbox"("financialAccessChallengeId");
CREATE UNIQUE INDEX "NotificationOutbox_subscriptionEntitlementEventId_key"
  ON "NotificationOutbox"("subscriptionEntitlementEventId");
CREATE UNIQUE INDEX "NotificationOutbox_subscriptionPurchaseId_key"
  ON "NotificationOutbox"("subscriptionPurchaseId");
CREATE INDEX "NotificationOutbox_refundRequest_idx"
  ON "NotificationOutbox"("refundRequestId");
CREATE UNIQUE INDEX "NotificationOutbox_administrativeAccountActionId_key"
  ON "NotificationOutbox"("administrativeAccountActionId");

ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_financialAccessChallengeId_fkey"
  FOREIGN KEY ("financialAccessChallengeId")
  REFERENCES "FinancialAccessChallenge"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_subscriptionEntitlementEventId_fkey"
  FOREIGN KEY ("subscriptionEntitlementEventId")
  REFERENCES "SubscriptionEntitlementEvent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_subscriptionPurchaseId_fkey"
  FOREIGN KEY ("subscriptionPurchaseId")
  REFERENCES "SubscriptionPurchase"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_refundRequestId_fkey"
  FOREIGN KEY ("refundRequestId")
  REFERENCES "RefundRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_administrativeAccountActionId_fkey"
  FOREIGN KEY ("administrativeAccountActionId")
  REFERENCES "AdministrativeAccountAction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT IF EXISTS "NotificationOutbox_source_type_check";
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
    AND ("notificationType" <> 'FINANCIAL_ACCESS_VERIFICATION' OR "financialAccessChallengeId" IS NOT NULL)
    AND ("financialAccessChallengeId" IS NULL OR "notificationType" = 'FINANCIAL_ACCESS_VERIFICATION')
    AND (
      "notificationType" NOT IN ('SUBSCRIPTION_GRACE_ENTERED','SUBSCRIPTION_SUSPENDED','SUBSCRIPTION_RESTORED')
      OR "subscriptionEntitlementEventId" IS NOT NULL
    )
    AND (
      "subscriptionEntitlementEventId" IS NULL
      OR "notificationType" IN ('SUBSCRIPTION_GRACE_ENTERED','SUBSCRIPTION_SUSPENDED','SUBSCRIPTION_RESTORED')
    )
    AND ("notificationType" <> 'SUBSCRIPTION_PAYMENT_SUCCEEDED' OR "subscriptionPurchaseId" IS NOT NULL)
    AND ("subscriptionPurchaseId" IS NULL OR "notificationType" = 'SUBSCRIPTION_PAYMENT_SUCCEEDED')
    AND (
      "notificationType" NOT IN ('REFUND_REQUEST_SUBMITTED','REFUND_COMPLETED','REFUND_FAILED')
      OR "refundRequestId" IS NOT NULL
    )
    AND (
      "refundRequestId" IS NULL
      OR "notificationType" IN ('REFUND_REQUEST_SUBMITTED','REFUND_COMPLETED','REFUND_FAILED')
    )
    AND (
      "notificationType" NOT IN ('COMPLIANCE_SUSPENSION_IMPOSED','COMPLIANCE_SUSPENSION_LIFTED')
      OR "administrativeAccountActionId" IS NOT NULL
    )
    AND (
      "administrativeAccountActionId" IS NULL
      OR "notificationType" IN ('COMPLIANCE_SUSPENSION_IMPOSED','COMPLIANCE_SUSPENSION_LIFTED')
    )
  );

ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT IF EXISTS "NotificationOutbox_practice_location_scope_check";
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_practice_location_scope_check"
  CHECK (
    (
      "notificationType" IN (
        'PASSWORD_RESET','DOCTOR_EMAIL_VERIFICATION','FINANCIAL_ACCESS_VERIFICATION',
        'SUBSCRIPTION_GRACE_ENTERED','SUBSCRIPTION_PAYMENT_SUCCEEDED',
        'SUBSCRIPTION_SUSPENDED','SUBSCRIPTION_RESTORED',
        'REFUND_REQUEST_SUBMITTED','REFUND_COMPLETED','REFUND_FAILED',
        'COMPLIANCE_SUSPENSION_IMPOSED','COMPLIANCE_SUSPENSION_LIFTED'
      )
      AND "practiceLocationId" IS NULL
    )
    OR (
      "notificationType" IN (
        'BOOKING_CONFIRMATION','APPOINTMENT_CANCELLATION','CLINIC_DAY_CANCELLATION',
        'SCHEDULED_REMINDER','SECURITY_NOTIFICATION','OTP_VERIFICATION','SECRETARY_INVITATION'
      )
      AND "practiceLocationId" IS NOT NULL
    )
  );

ALTER TABLE "NotificationOutbox"
  DROP CONSTRAINT IF EXISTS "NotificationOutbox_channel_type_check";
ALTER TABLE "NotificationOutbox"
  ADD CONSTRAINT "NotificationOutbox_channel_type_check"
  CHECK (
    (
      "notificationType" IN (
        'BOOKING_CONFIRMATION','APPOINTMENT_CANCELLATION','CLINIC_DAY_CANCELLATION',
        'SCHEDULED_REMINDER','SECURITY_NOTIFICATION','OTP_VERIFICATION'
      )
      AND "channel" = 'SMS'
    )
    OR (
      "notificationType" IN (
        'SECRETARY_INVITATION','PASSWORD_RESET','DOCTOR_EMAIL_VERIFICATION',
        'FINANCIAL_ACCESS_VERIFICATION','SUBSCRIPTION_GRACE_ENTERED',
        'SUBSCRIPTION_PAYMENT_SUCCEEDED','SUBSCRIPTION_SUSPENDED',
        'SUBSCRIPTION_RESTORED','REFUND_REQUEST_SUBMITTED','REFUND_COMPLETED',
        'REFUND_FAILED','COMPLIANCE_SUSPENSION_IMPOSED','COMPLIANCE_SUSPENSION_LIFTED'
      )
      AND "channel" = 'EMAIL'
    )
  );