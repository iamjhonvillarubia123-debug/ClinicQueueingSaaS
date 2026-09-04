-- Preserve the existing secretary-lifecycle context invariant while permitting
-- the new explicitly typed account-only notices. No rows are removed.
ALTER TABLE "ApplicationNotification" DROP CONSTRAINT "ApplicationNotification_secretary_context_check";
ALTER TABLE "ApplicationNotification" ADD CONSTRAINT "ApplicationNotification_secretary_context_check"
CHECK (("notificationType" = 'ACCOUNT_ACTIVITY' AND "title" IS NOT NULL AND "message" IS NOT NULL)
  OR ("notificationType" <> 'ACCOUNT_ACTIVITY' AND "affectedSecretaryUserId" IS NOT NULL AND "practiceLocationId" IS NOT NULL));
