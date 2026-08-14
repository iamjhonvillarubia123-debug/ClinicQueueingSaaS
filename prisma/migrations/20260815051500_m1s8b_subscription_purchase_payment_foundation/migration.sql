-- M1S8B SUBSCRIPTION PURCHASE / PAYMENT FOUNDATION
--
-- Establishes the durable subscription purchase decision and separates
-- external provider payment evidence from entitlement authority.
--
-- NotificationOutbox Phase 5 financial source extensions are intentionally
-- reconciled later in one coordinated migration after all required source
-- parents (SubscriptionEntitlementEvent, SubscriptionPurchase, RefundRequest)
-- exist.

CREATE TYPE "SubscriptionPurchaseStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "SubscriptionPaymentStatus" AS ENUM (
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "SubscriptionPurchase" (
  "id" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "purchasedByUserId" TEXT NOT NULL,
  "monthsPurchased" INTEGER NOT NULL,
  "monthlyPriceSnapshot" DECIMAL(18,2) NOT NULL,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "creditAmountApplied" DECIMAL(18,2) NOT NULL,
  "externalAmountRequired" DECIMAL(18,2) NOT NULL,
  "periodStart" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "periodEnd" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "status" "SubscriptionPurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "commandIdempotencyId" TEXT,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3) WITH TIME ZONE,

  CONSTRAINT "SubscriptionPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPurchase_commandIdempotencyId_key"
  ON "SubscriptionPurchase"("commandIdempotencyId");

CREATE INDEX "SubscriptionPurchase_financialAccount_created_idx"
  ON "SubscriptionPurchase"("doctorFinancialAccountId", "createdAt");

CREATE INDEX "SubscriptionPurchase_purchasedBy_created_idx"
  ON "SubscriptionPurchase"("purchasedByUserId", "createdAt");

CREATE INDEX "SubscriptionPurchase_status_created_idx"
  ON "SubscriptionPurchase"("status", "createdAt");

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_purchasedByUserId_fkey"
  FOREIGN KEY ("purchasedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_months_positive_check"
  CHECK ("monthsPurchased" >= 1);

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_amount_shape_check"
  CHECK (
    "monthlyPriceSnapshot" > 0
    AND "grossAmount" > 0
    AND "grossAmount" = "monthlyPriceSnapshot" * "monthsPurchased"
    AND "creditAmountApplied" >= 0
    AND "externalAmountRequired" >= 0
    AND "creditAmountApplied" <= "grossAmount"
    AND "externalAmountRequired" <= "grossAmount"
    AND "grossAmount" = "creditAmountApplied" + "externalAmountRequired"
  );

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_period_order_check"
  CHECK ("periodEnd" > "periodStart");

ALTER TABLE "SubscriptionPurchase"
  ADD CONSTRAINT "SubscriptionPurchase_status_shape_check"
  CHECK (
    (
      "status" = 'PENDING'
      AND "completedAt" IS NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "completedAt" IS NOT NULL
      AND "completedAt" >= "createdAt"
    )
    OR (
      "status" IN ('FAILED', 'EXPIRED')
      AND "completedAt" IS NULL
    )
  );

CREATE TABLE "SubscriptionPayment" (
  "id" TEXT NOT NULL,
  "subscriptionPurchaseId" TEXT NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "providerPaymentReference" VARCHAR(200) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "initiatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "confirmedAt" TIMESTAMP(3) WITH TIME ZONE,
  "failedAt" TIMESTAMP(3) WITH TIME ZONE,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPayment_provider_reference_key"
  ON "SubscriptionPayment"("provider", "providerPaymentReference");

CREATE INDEX "SubscriptionPayment_purchase_created_idx"
  ON "SubscriptionPayment"("subscriptionPurchaseId", "createdAt");

CREATE INDEX "SubscriptionPayment_status_created_idx"
  ON "SubscriptionPayment"("status", "createdAt");

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_subscriptionPurchaseId_fkey"
  FOREIGN KEY ("subscriptionPurchaseId") REFERENCES "SubscriptionPurchase"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_provider_shape_check"
  CHECK (
    NULLIF(BTRIM("provider"), '') IS NOT NULL
    AND NULLIF(BTRIM("providerPaymentReference"), '') IS NOT NULL
  );

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_timestamp_order_check"
  CHECK (
    "initiatedAt" >= "createdAt"
    AND ("confirmedAt" IS NULL OR "confirmedAt" >= "initiatedAt")
    AND ("failedAt" IS NULL OR "failedAt" >= "initiatedAt")
  );

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_status_shape_check"
  CHECK (
    (
      "status" = 'PENDING'
      AND "confirmedAt" IS NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "confirmedAt" IS NOT NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "confirmedAt" IS NULL
      AND "failedAt" IS NOT NULL
    )
    OR (
      "status" = 'EXPIRED'
      AND "confirmedAt" IS NULL
      AND "failedAt" IS NULL
    )
  );