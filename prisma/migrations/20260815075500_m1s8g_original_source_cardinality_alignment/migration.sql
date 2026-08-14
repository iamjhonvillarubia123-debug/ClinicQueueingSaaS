-- M1S8G original-source cardinality alignment.
-- Removes unintended one-to-one uniqueness introduced during reconstruction.
-- No rows or business data are deleted.

DROP INDEX IF EXISTS "NotificationOutbox_financialAccessChallengeId_key";
DROP INDEX IF EXISTS "NotificationOutbox_subscriptionEntitlementEventId_key";
DROP INDEX IF EXISTS "NotificationOutbox_subscriptionPurchaseId_key";
DROP INDEX IF EXISTS "NotificationOutbox_administrativeAccountActionId_key";

CREATE INDEX IF NOT EXISTS "NotificationOutbox_financialAccessChallenge_idx"
  ON "NotificationOutbox"("financialAccessChallengeId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_subscriptionEntitlementEvent_idx"
  ON "NotificationOutbox"("subscriptionEntitlementEventId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_subscriptionPurchase_idx"
  ON "NotificationOutbox"("subscriptionPurchaseId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_administrativeAccountAction_idx"
  ON "NotificationOutbox"("administrativeAccountActionId");