-- M1S8A FINANCIAL OWNER / ENTITLEMENT FOUNDATION
--
-- Establishes the durable DoctorFinancialAccount aggregate root for one
-- Doctor User-era and the one-to-one authoritative subscription entitlement
-- boundary.
--
-- This slice also synchronizes the deferred Slice 7
-- CommandIdempotency.doctorFinancialAccountId foreign key.
--
-- Purchase/payment/credit/refund/access/event models follow in later Slice 8
-- sub-slices.

CREATE TABLE "DoctorFinancialAccount" (
  "id" TEXT NOT NULL,
  "doctorUserId" TEXT NOT NULL,
  "recoveryEmailEncrypted" TEXT,
  "recoveryEmailHash" VARCHAR(64),
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "DoctorFinancialAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoctorFinancialAccount_doctorUserId_key"
  ON "DoctorFinancialAccount"("doctorUserId");

CREATE INDEX "DoctorFinancialAccount_recoveryEmailHash_idx"
  ON "DoctorFinancialAccount"("recoveryEmailHash");

ALTER TABLE "DoctorFinancialAccount"
  ADD CONSTRAINT "DoctorFinancialAccount_doctorUserId_fkey"
  FOREIGN KEY ("doctorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoctorFinancialAccount"
  ADD CONSTRAINT "DoctorFinancialAccount_recovery_email_shape_check"
  CHECK (
    (
      "recoveryEmailEncrypted" IS NULL
      AND "recoveryEmailHash" IS NULL
    )
    OR
    (
      "recoveryEmailEncrypted" IS NOT NULL
      AND "recoveryEmailHash" IS NOT NULL
      AND length("recoveryEmailHash") = 64
    )
  );

CREATE TABLE "DoctorSubscriptionEntitlement" (
  "id" TEXT NOT NULL,
  "doctorFinancialAccountId" TEXT NOT NULL,
  "paidThrough" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "graceEndsAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

  CONSTRAINT "DoctorSubscriptionEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoctorSubscriptionEntitlement_doctorFinancialAccountId_key"
  ON "DoctorSubscriptionEntitlement"("doctorFinancialAccountId");

ALTER TABLE "DoctorSubscriptionEntitlement"
  ADD CONSTRAINT "DoctorSubscriptionEntitlement_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoctorSubscriptionEntitlement"
  ADD CONSTRAINT "DoctorSubscriptionEntitlement_grace_duration_check"
  CHECK ("graceEndsAt" = "paidThrough" + INTERVAL '7 days');

-- Slice 7 deliberately created doctorFinancialAccountId as a nullable scalar
-- until the canonical financial parent existed.
ALTER TABLE "CommandIdempotency"
  ADD CONSTRAINT "CommandIdempotency_doctorFinancialAccountId_fkey"
  FOREIGN KEY ("doctorFinancialAccountId") REFERENCES "DoctorFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;