-- M1S8D REFUND REQUEST / PROCESSING FOUNDATION
--
-- Establishes immutable post-closure RefundRequest business ownership and
-- append-only RefundProcessingAttempt evidence.
--
-- Also binds the deferred SubscriptionCreditEntry.refundRequestId FK.
--
-- FinancialAccessSession authorization and NotificationOutbox financial
-- source extensions are added in later Slice 8 sub-slices.

CREATE TYPE "RefundMethod" AS ENUM (
  'GCASH',
  'MAYA'
);

CREATE TYPE "RefundRequestStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "RefundRequest" (
  "id" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "requestedAmount" DECIMAL(18,2) NOT NULL,
  "reasonCode" VARCHAR(100) NOT NULL,
  "otherReasonText" VARCHAR(1000),
  "method" "RefundMethod" NOT NULL,
  "accountNameProtected" TEXT NOT NULL,
  "destinationProtected" TEXT NOT NULL,
  "destinationLast4" VARCHAR(4) NOT NULL,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "completedAt" TIMESTAMP(3) WITH TIME ZONE,
  "failedAt" TIMESTAMP(3) WITH TIME ZONE,
  "processedBySystemAdminUserId" TEXT,
  "completionReference" VARCHAR(255),
  "proofReference" VARCHAR(500),
  "commandIdempotencyId" TEXT,

  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRequest_commandIdempotencyId_key"
  ON "RefundRequest"("commandIdempotencyId");

CREATE INDEX "RefundRequest_financialAccount_submitted_idx"
  ON "RefundRequest"("doctorFinancialAccountId", "submittedAt");

CREATE INDEX "RefundRequest_status_submitted_idx"
  ON "RefundRequest"("status", "submittedAt");

CREATE INDEX "RefundRequest_processedBy_idx"
  ON "RefundRequest"("processedBySystemAdminUserId");

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_processedBySystemAdminUserId_fkey"
  FOREIGN KEY ("processedBySystemAdminUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_commandIdempotencyId_fkey"
  FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_amount_positive_check"
  CHECK ("requestedAmount" > 0);

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_reason_shape_check"
  CHECK (
    NULLIF(BTRIM("reasonCode"), '') IS NOT NULL
    AND (
      "otherReasonText" IS NULL
      OR NULLIF(BTRIM("otherReasonText"), '') IS NOT NULL
    )
  );

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_destination_shape_check"
  CHECK (
    NULLIF(BTRIM("accountNameProtected"), '') IS NOT NULL
    AND NULLIF(BTRIM("destinationProtected"), '') IS NOT NULL
    AND "destinationLast4" ~ '^[0-9]{4}$'
  );

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_lifecycle_shape_check"
  CHECK (
    (
      "status" = 'PENDING'
      AND "completedAt" IS NULL
      AND "failedAt" IS NULL
      AND "completionReference" IS NULL
      AND "proofReference" IS NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "completedAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "processedBySystemAdminUserId" IS NOT NULL
      AND NULLIF(BTRIM("completionReference"), '') IS NOT NULL
      AND NULLIF(BTRIM("proofReference"), '') IS NOT NULL
      AND "completedAt" >= "submittedAt"
    )
    OR (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL
      AND "completedAt" IS NULL
      AND "processedBySystemAdminUserId" IS NOT NULL
      AND "completionReference" IS NULL
      AND "proofReference" IS NULL
      AND "failedAt" >= "submittedAt"
    )
  );

CREATE TABLE "RefundProcessingAttempt" (
  "id" TEXT NOT NULL,
  "refundRequestId" TEXT NOT NULL,
  "processedBySystemAdminUserId" TEXT,
  "provider" VARCHAR(100) NOT NULL,
  "attemptReference" VARCHAR(255) NOT NULL,
  "attemptedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "outcome" VARCHAR(100) NOT NULL,
  "failureCategory" VARCHAR(100),
  "failureDetailSanitized" VARCHAR(1000),

  CONSTRAINT "RefundProcessingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RefundProcessingAttempt_refund_attempted_idx"
  ON "RefundProcessingAttempt"("refundRequestId", "attemptedAt");

CREATE INDEX "RefundProcessingAttempt_admin_attempted_idx"
  ON "RefundProcessingAttempt"("processedBySystemAdminUserId", "attemptedAt");

CREATE INDEX "RefundProcessingAttempt_provider_reference_idx"
  ON "RefundProcessingAttempt"("provider", "attemptReference");

ALTER TABLE "RefundProcessingAttempt"
  ADD CONSTRAINT "RefundProcessingAttempt_refundRequestId_fkey"
  FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundProcessingAttempt"
  ADD CONSTRAINT "RefundProcessingAttempt_processedBySystemAdminUserId_fkey"
  FOREIGN KEY ("processedBySystemAdminUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefundProcessingAttempt"
  ADD CONSTRAINT "RefundProcessingAttempt_text_shape_check"
  CHECK (
    NULLIF(BTRIM("provider"), '') IS NOT NULL
    AND NULLIF(BTRIM("attemptReference"), '') IS NOT NULL
    AND NULLIF(BTRIM("outcome"), '') IS NOT NULL
    AND (
      "failureCategory" IS NULL
      OR NULLIF(BTRIM("failureCategory"), '') IS NOT NULL
    )
    AND (
      "failureDetailSanitized" IS NULL
      OR NULLIF(BTRIM("failureDetailSanitized"), '') IS NOT NULL
    )
  );

-- Bind M1S8C's deliberately deferred refund correlation.
ALTER TABLE "SubscriptionCreditEntry"
  ADD CONSTRAINT "SubscriptionCreditEntry_refundRequestId_fkey"
  FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;