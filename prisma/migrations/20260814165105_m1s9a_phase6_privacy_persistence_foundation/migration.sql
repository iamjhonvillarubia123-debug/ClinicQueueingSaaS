-- CreateEnum
CREATE TYPE "RetentionResourceType" AS ENUM ('APPOINTMENT');

-- CreateEnum
CREATE TYPE "RetentionHoldReasonCategory" AS ENUM ('LEGAL_REQUIREMENT', 'REGULATORY_REQUIREMENT', 'ACTIVE_LEGAL_CLAIM', 'PRESERVATION_ORDER');

-- CreateEnum
CREATE TYPE "PrivacyErasureResourceType" AS ENUM ('APPOINTMENT');

-- CreateTable
CREATE TABLE "QueueAnalyticsDaily" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "servedCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "absenceCount" INTEGER NOT NULL DEFAULT 0,
    "waitingDurationTotalSeconds" BIGINT NOT NULL DEFAULT 0,
    "waitingDurationSampleCount" INTEGER NOT NULL DEFAULT 0,
    "serviceDurationTotalSeconds" BIGINT NOT NULL DEFAULT 0,
    "serviceDurationSampleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QueueAnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyErasureLedger" (
    "id" TEXT NOT NULL,
    "resourceType" "PrivacyErasureResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "erasureCommittedAt" TIMESTAMPTZ(3) NOT NULL,
    "backupReplayUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyErasureLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionHold" (
    "id" TEXT NOT NULL,
    "resourceType" "RetentionResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "reasonCategory" "RetentionHoldReasonCategory" NOT NULL,
    "reference" VARCHAR(255),
    "explanation" VARCHAR(1000) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RetentionHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueAnalyticsDaily_serviceDate_idx" ON "QueueAnalyticsDaily"("serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "QueueAnalyticsDaily_location_serviceDate_key" ON "QueueAnalyticsDaily"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE INDEX "PrivacyErasureLedger_backupReplayUntil_idx" ON "PrivacyErasureLedger"("backupReplayUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyErasureLedger_resource_key" ON "PrivacyErasureLedger"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "RetentionHold_resource_active_idx" ON "RetentionHold"("resourceType", "resourceId", "releasedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "RetentionHold_reviewAt_idx" ON "RetentionHold"("reviewAt");

-- CreateIndex
CREATE INDEX "RetentionHold_expiresAt_idx" ON "RetentionHold"("expiresAt");

-- CreateIndex
CREATE INDEX "RetentionHold_createdBy_created_idx" ON "RetentionHold"("createdByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "QueueAnalyticsDaily" ADD CONSTRAINT "QueueAnalyticsDaily_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S9A MANUAL POSTGRESQL INVARIANTS
--
-- Prisma cannot express these stable same-row invariants directly.
-- They are part of the reviewed migration history.

ALTER TABLE "RetentionHold"
  ADD CONSTRAINT "RetentionHold_time_order_check"
  CHECK (
    "expiresAt" > "createdAt"
    AND "reviewAt" <= "expiresAt"
    AND ("releasedAt" IS NULL OR "releasedAt" >= "createdAt")
  );

ALTER TABLE "QueueAnalyticsDaily"
  ADD CONSTRAINT "QueueAnalyticsDaily_nonnegative_metrics_check"
  CHECK (
    "bookedCount" >= 0
    AND "servedCount" >= 0
    AND "cancelledCount" >= 0
    AND "absenceCount" >= 0
    AND "waitingDurationTotalSeconds" >= 0
    AND "waitingDurationSampleCount" >= 0
    AND "serviceDurationTotalSeconds" >= 0
    AND "serviceDurationSampleCount" >= 0
  );

ALTER TABLE "PrivacyErasureLedger"
  ADD CONSTRAINT "PrivacyErasureLedger_replay_window_check"
  CHECK (
    "backupReplayUntil" >= "erasureCommittedAt"
  );