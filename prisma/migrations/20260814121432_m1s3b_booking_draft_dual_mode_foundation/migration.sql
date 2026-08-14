-- CreateEnum
CREATE TYPE "BookingDraftMode" AS ENUM ('INDIVIDUAL', 'MULTI_PERSON');

-- DropIndex
DROP INDEX "BookingDraftAnswer_bookingDraftId_bookingQuestionId_key";

-- AlterTable
ALTER TABLE "BookingDraft" ADD COLUMN     "mode" "BookingDraftMode" NOT NULL DEFAULT 'INDIVIDUAL',
ALTER COLUMN "firstName" DROP NOT NULL,
ALTER COLUMN "lastName" DROP NOT NULL,
ALTER COLUMN "estimatedServiceMinutes" DROP NOT NULL,
ALTER COLUMN "existingPatientResponse" DROP NOT NULL,
ALTER COLUMN "mobileNumberEncrypted" DROP NOT NULL,
ALTER COLUMN "mobileNumberHash" DROP NOT NULL,
ALTER COLUMN "mobileNumberLastFour" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BookingDraftAnswer" ADD COLUMN     "bookingDraftMemberId" TEXT;

-- CreateTable
CREATE TABLE "BookingDraftMember" (
    "id" TEXT NOT NULL,
    "bookingDraftId" TEXT NOT NULL,
    "memberOrder" INTEGER NOT NULL,
    "firstName" VARCHAR(100),
    "middleName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "suffix" VARCHAR(20),
    "existingPatientResponse" "ExistingPatientResponse",
    "estimatedServiceMinutes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingDraftMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingDraftServiceSelection" (
    "id" TEXT NOT NULL,
    "bookingDraftId" TEXT NOT NULL,
    "bookingDraftMemberId" TEXT,
    "practiceLocationServiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDraftServiceSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingDraftMember_bookingDraftId_idx" ON "BookingDraftMember"("bookingDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingDraftMember_bookingDraftId_memberOrder_key" ON "BookingDraftMember"("bookingDraftId", "memberOrder");

-- CreateIndex
CREATE INDEX "BookingDraftServiceSelection_bookingDraftId_idx" ON "BookingDraftServiceSelection"("bookingDraftId");

-- CreateIndex
CREATE INDEX "BookingDraftServiceSelection_bookingDraftMemberId_idx" ON "BookingDraftServiceSelection"("bookingDraftMemberId");

-- CreateIndex
CREATE INDEX "BookingDraftServiceSelection_practiceLocationServiceId_idx" ON "BookingDraftServiceSelection"("practiceLocationServiceId");

-- CreateIndex
CREATE INDEX "BookingDraft_mode_status_expiresAt_idx" ON "BookingDraft"("mode", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingDraftAnswer_bookingDraftId_idx" ON "BookingDraftAnswer"("bookingDraftId");

-- CreateIndex
CREATE INDEX "BookingDraftAnswer_bookingDraftMemberId_idx" ON "BookingDraftAnswer"("bookingDraftMemberId");

-- AddForeignKey
ALTER TABLE "BookingDraftMember" ADD CONSTRAINT "BookingDraftMember_bookingDraftId_fkey" FOREIGN KEY ("bookingDraftId") REFERENCES "BookingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftServiceSelection" ADD CONSTRAINT "BookingDraftServiceSelection_bookingDraftId_fkey" FOREIGN KEY ("bookingDraftId") REFERENCES "BookingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftServiceSelection" ADD CONSTRAINT "BookingDraftServiceSelection_bookingDraftMemberId_fkey" FOREIGN KEY ("bookingDraftMemberId") REFERENCES "BookingDraftMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftServiceSelection" ADD CONSTRAINT "BookingDraftServiceSelection_practiceLocationServiceId_fkey" FOREIGN KEY ("practiceLocationServiceId") REFERENCES "PracticeLocationService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftAnswer" ADD CONSTRAINT "BookingDraftAnswer_bookingDraftMemberId_fkey" FOREIGN KEY ("bookingDraftMemberId") REFERENCES "BookingDraftMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S3B BOOKINGDRAFT INDEX RECONCILIATION
DROP INDEX IF EXISTS "BookingDraft_mobileNumberHash_expiresAt_idx";
DROP INDEX IF EXISTS "BookingDraft_expiresAt_idx";

CREATE INDEX "BookingDraft_mobileNumberHash_practiceLocationId_serviceDate_status_idx"
ON "BookingDraft"(
    "mobileNumberHash",
    "practiceLocationId",
    "serviceDate",
    "status"
);

CREATE INDEX "BookingDraft_status_expiresAt_idx"
ON "BookingDraft"("status", "expiresAt");
-- M1S3B MANUAL POSTGRESQL CONSTRAINTS

-- MULTI_PERSON parent rows must not carry person-specific member identity or
-- one shared member duration. INDIVIDUAL rows stay nullable in storage because
-- approved terminal privacy cleanup may erase protected identity.
ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_mode_shape_check"
CHECK (
    "mode" = 'INDIVIDUAL'::"BookingDraftMode"
    OR (
        "mode" = 'MULTI_PERSON'::"BookingDraftMode"
        AND "firstName" IS NULL
        AND "middleName" IS NULL
        AND "lastName" IS NULL
        AND "suffix" IS NULL
        AND "existingPatientResponse" IS NULL
        AND "estimatedServiceMinutes" IS NULL
    )
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_estimated_service_minutes_check"
CHECK (
    "estimatedServiceMinutes" IS NULL
    OR "estimatedServiceMinutes" > 0
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_expiration_order_check"
CHECK ("expiresAt" > "createdAt");

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_terminal_timestamp_shape_check"
CHECK (
    (
        "status" = 'CONSUMED'::"BookingDraftStatus"
        AND "consumedAt" IS NOT NULL
        AND "cancelledAt" IS NULL
    )
    OR
    (
        "status" = 'CANCELLED'::"BookingDraftStatus"
        AND "cancelledAt" IS NOT NULL
        AND "consumedAt" IS NULL
    )
    OR
    (
        "status" IN (
            'PENDING_OTP'::"BookingDraftStatus",
            'EXPIRED'::"BookingDraftStatus"
        )
        AND "consumedAt" IS NULL
        AND "cancelledAt" IS NULL
    )
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_consumed_at_order_check"
CHECK (
    "consumedAt" IS NULL
    OR "consumedAt" >= "createdAt"
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_cancelled_at_order_check"
CHECK (
    "cancelledAt" IS NULL
    OR "cancelledAt" >= "createdAt"
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_mobile_last_four_check"
CHECK (
    "mobileNumberLastFour" IS NULL
    OR "mobileNumberLastFour" ~ '^[0-9]{4}$'
);

ALTER TABLE "BookingDraftMember"
ADD CONSTRAINT "BookingDraftMember_member_order_check"
CHECK ("memberOrder" BETWEEN 1 AND 5);

ALTER TABLE "BookingDraftMember"
ADD CONSTRAINT "BookingDraftMember_estimated_service_minutes_check"
CHECK (
    "estimatedServiceMinutes" IS NULL
    OR "estimatedServiceMinutes" > 0
);

-- Answer ownership uniqueness:
-- INDIVIDUAL: one draft + one question.
-- MULTI_PERSON: one member + one question.
CREATE UNIQUE INDEX "BookingDraftAnswer_individual_question_key"
ON "BookingDraftAnswer"(
    "bookingDraftId",
    "bookingQuestionId"
)
WHERE "bookingDraftMemberId" IS NULL;

CREATE UNIQUE INDEX "BookingDraftAnswer_member_question_key"
ON "BookingDraftAnswer"(
    "bookingDraftMemberId",
    "bookingQuestionId"
)
WHERE "bookingDraftMemberId" IS NOT NULL;

-- Temporary Service-selection uniqueness.
-- The maximum-three rule remains protected application/concurrency logic.
CREATE UNIQUE INDEX "BookingDraftServiceSelection_individual_service_key"
ON "BookingDraftServiceSelection"(
    "bookingDraftId",
    "practiceLocationServiceId"
)
WHERE "bookingDraftMemberId" IS NULL;

CREATE UNIQUE INDEX "BookingDraftServiceSelection_member_service_key"
ON "BookingDraftServiceSelection"(
    "bookingDraftMemberId",
    "practiceLocationServiceId"
)
WHERE "bookingDraftMemberId" IS NOT NULL;