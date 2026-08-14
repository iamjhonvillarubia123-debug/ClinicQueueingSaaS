-- M1S8F SUBSCRIPTION ENTITLEMENT EVENT FOUNDATION
--
-- Establishes append-only durable identity for one actual Doctor
-- subscription entitlement transition occurrence.
--
-- DoctorSubscriptionEntitlement remains current commercial authority.
-- This event table is historical transition/audit identity only.
--
-- Phase 5 NotificationOutbox source/type reconciliation follows in M1S8G
-- after this final financial notification source parent exists.

CREATE TYPE "SubscriptionEntitlementEventType" AS ENUM (
  'GRACE_ENTERED',
  'SUSPENDED',
  'RESTORED'
);

CREATE TABLE "SubscriptionEntitlementEvent" (
  "id" TEXT NOT NULL,
  "doctorSubscriptionEntitlementId" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "eventType" "SubscriptionEntitlementEventType" NOT NULL,
  "effectiveAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "subscriptionPurchaseId" TEXT,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionEntitlementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionEntitlementEvent_transition_occurrence_key"
  ON "SubscriptionEntitlementEvent"(
    "doctorSubscriptionEntitlementId",
    "eventType",
    "effectiveAt"
  );

CREATE INDEX "SubscriptionEntitlementEvent_financialAccount_effective_idx"
  ON "SubscriptionEntitlementEvent"(
    "doctorFinancialAccountId",
    "effectiveAt"
  );

CREATE INDEX "SubscriptionEntitlementEvent_entitlement_effective_idx"
  ON "SubscriptionEntitlementEvent"(
    "doctorSubscriptionEntitlementId",
    "effectiveAt"
  );

CREATE INDEX "SubscriptionEntitlementEvent_purchase_idx"
  ON "SubscriptionEntitlementEvent"("subscriptionPurchaseId");

ALTER TABLE "SubscriptionEntitlementEvent"
  ADD CONSTRAINT "SubscriptionEntitlementEvent_doctorSubscriptionEntitlementId_fkey"
  FOREIGN KEY ("doctorSubscriptionEntitlementId")
  REFERENCES "DoctorSubscriptionEntitlement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEntitlementEvent"
  ADD CONSTRAINT "SubscriptionEntitlementEvent_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId")
  REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEntitlementEvent"
  ADD CONSTRAINT "SubscriptionEntitlementEvent_subscriptionPurchaseId_fkey"
  FOREIGN KEY ("subscriptionPurchaseId")
  REFERENCES "SubscriptionPurchase"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SubscriptionEntitlementEvent"
  ADD CONSTRAINT "SubscriptionEntitlementEvent_purchase_correlation_check"
  CHECK (
    "subscriptionPurchaseId" IS NULL
    OR "eventType" = 'RESTORED'
  );