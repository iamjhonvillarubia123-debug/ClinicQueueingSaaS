-- M1S8C SUBSCRIPTION CREDIT LEDGER FOUNDATION
--
-- Establishes the append/audit-oriented monetary credit ledger.
-- Credit is stored as money, not months.
--
-- refundRequestId remains a nullable scalar until RefundRequest is created
-- in the next financial dependency slice; that FK is synchronized there.

CREATE TYPE "SubscriptionCreditEntryType" AS ENUM (
  'CREDIT_CREATED',
  'PURCHASE_RESERVED',
  'PURCHASE_CONSUMED',
  'PURCHASE_RELEASED',
  'REFUND_RESERVED',
  'REFUND_FAILED_RELEASED',
  'RECOVERY_TRANSFER_OUT',
  'RECOVERY_TRANSFER_IN',
  'ADJUSTMENT'
);

CREATE TABLE "SubscriptionCreditEntry" (
  "id" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "entryType" "SubscriptionCreditEntryType" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "subscriptionPurchaseId" TEXT,
  "refundRequestId" TEXT,
  "counterpartyDoctorFinancialAccountId" TEXT,
  "relatedCreditEntryId" TEXT,
  "commandIdempotencyId" TEXT,
  "occurredAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "SubscriptionCreditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionCreditEntry_financialAccount_occurred_idx"
  ON "SubscriptionCreditEntry"("doctorFinancialAccountId", "occurredAt");

CREATE INDEX "SubscriptionCreditEntry_purchase_idx"
  ON "SubscriptionCreditEntry"("subscriptionPurchaseId");

CREATE INDEX "SubscriptionCreditEntry_refundRequest_idx"
  ON "SubscriptionCreditEntry"("refundRequestId");

CREATE INDEX "SubscriptionCreditEntry_counterparty_idx"
  ON "SubscriptionCreditEntry"("counterpartyDoctorFinancialAccountId");

CREATE INDEX "SubscriptionCreditEntry_related_idx"
  ON "SubscriptionCreditEntry"("relatedCreditEntryId");

CREATE UNIQUE INDEX "SubscriptionCreditEntry_related_terminal_key"
  ON "SubscriptionCreditEntry"("relatedCreditEntryId")
  WHERE "entryType" IN (
    'PURCHASE_CONSUMED',
    'PURCHASE_RELEASED',
    'REFUND_FAILED_RELEASED'
  );

CREATE UNIQUE INDEX "SubscriptionCreditEntry_recovery_transfer_pair_key"
  ON "SubscriptionCreditEntry"("relatedCreditEntryId")
  WHERE "entryType" = 'RECOVERY_TRANSFER_IN';

CREATE INDEX "SubscriptionCreditEntry_command_idx"
  ON "SubscriptionCreditEntry"("commandIdempotencyId");

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_subscriptionPurchaseId_fkey"
  FOREIGN KEY ("subscriptionPurchaseId") REFERENCES "SubscriptionPurchase"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_counterpartyDoctorFinancialAccountId_fkey"
  FOREIGN KEY ("counterpartyDoctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_relatedCreditEntryId_fkey"
  FOREIGN KEY ("relatedCreditEntryId") REFERENCES "SubscriptionCreditEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_not_self_related_check"
  CHECK (
    "relatedCreditEntryId" IS NULL
    OR "relatedCreditEntryId" <> "id"
  );

ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_type_shape_check"
  CHECK (
    (
      "entryType" = 'CREDIT_CREATED'
      AND "subscriptionPurchaseId" IS NULL
      AND "refundRequestId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
      AND "relatedCreditEntryId" IS NULL
    )
    OR (
      "entryType" = 'PURCHASE_RESERVED'
      AND "subscriptionPurchaseId" IS NOT NULL
      AND "refundRequestId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
      AND "relatedCreditEntryId" IS NULL
    )
    OR (
      "entryType" IN ('PURCHASE_CONSUMED', 'PURCHASE_RELEASED')
      AND "subscriptionPurchaseId" IS NOT NULL
      AND "refundRequestId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
      AND "relatedCreditEntryId" IS NOT NULL
    )
    OR (
      "entryType" = 'REFUND_RESERVED'
      AND "refundRequestId" IS NOT NULL
      AND "subscriptionPurchaseId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
      AND "relatedCreditEntryId" IS NULL
    )
    OR (
      "entryType" = 'REFUND_FAILED_RELEASED'
      AND "refundRequestId" IS NOT NULL
      AND "subscriptionPurchaseId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
      AND "relatedCreditEntryId" IS NOT NULL
    )
    OR (
      "entryType" = 'RECOVERY_TRANSFER_OUT'
      AND "counterpartyDoctorFinancialAccountId" IS NOT NULL
      AND "counterpartyDoctorFinancialAccountId" <> "doctorFinancialAccountId"
      AND "subscriptionPurchaseId" IS NULL
      AND "refundRequestId" IS NULL
      AND "relatedCreditEntryId" IS NULL
    )
    OR (
      "entryType" = 'RECOVERY_TRANSFER_IN'
      AND "counterpartyDoctorFinancialAccountId" IS NOT NULL
      AND "counterpartyDoctorFinancialAccountId" <> "doctorFinancialAccountId"
      AND "subscriptionPurchaseId" IS NULL
      AND "refundRequestId" IS NULL
      AND "relatedCreditEntryId" IS NOT NULL
    )
    OR (
      "entryType" = 'ADJUSTMENT'
      AND "subscriptionPurchaseId" IS NULL
      AND "refundRequestId" IS NULL
      AND "counterpartyDoctorFinancialAccountId" IS NULL
    )
  );