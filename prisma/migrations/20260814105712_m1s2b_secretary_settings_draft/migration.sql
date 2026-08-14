-- CreateEnum
CREATE TYPE "SecretarySettingsDraftStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED_FOR_REWORK');

-- CreateTable
CREATE TABLE "SecretarySettingsDraft" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "authorPracticeStaffId" TEXT NOT NULL,
    "status" "SecretarySettingsDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedByUserId" TEXT,
    "reviewComment" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecretarySettingsDraft_practiceLocationId_status_idx" ON "SecretarySettingsDraft"("practiceLocationId", "status");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraft_authorPracticeStaffId_status_idx" ON "SecretarySettingsDraft"("authorPracticeStaffId", "status");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraft_reviewedByUserId_reviewedAt_idx" ON "SecretarySettingsDraft"("reviewedByUserId", "reviewedAt");

-- CreateIndex
CREATE INDEX "SecretarySettingsDraft_submittedAt_idx" ON "SecretarySettingsDraft"("submittedAt");

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraft" ADD CONSTRAINT "SecretarySettingsDraft_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraft" ADD CONSTRAINT "SecretarySettingsDraft_authorPracticeStaffId_fkey" FOREIGN KEY ("authorPracticeStaffId") REFERENCES "PracticeStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretarySettingsDraft" ADD CONSTRAINT "SecretarySettingsDraft_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S2B MANUAL POSTGRESQL CONSTRAINTS

-- Stable lifecycle row shape for the Secretary settings proposal control.
-- Exact authorization and transition legality remain application-transaction
-- responsibilities.
ALTER TABLE "SecretarySettingsDraft"
ADD CONSTRAINT "SecretarySettingsDraft_lifecycle_shape_check"
CHECK (
    (
        "status" = 'DRAFT'::"SecretarySettingsDraftStatus"
        AND "submittedAt" IS NULL
        AND "reviewedAt" IS NULL
        AND "reviewedByUserId" IS NULL
    )
    OR
    (
        "status" = 'SUBMITTED'::"SecretarySettingsDraftStatus"
        AND "submittedAt" IS NOT NULL
        AND "reviewedAt" IS NULL
        AND "reviewedByUserId" IS NULL
    )
    OR
    (
        "status" IN (
            'APPROVED'::"SecretarySettingsDraftStatus",
            'REJECTED'::"SecretarySettingsDraftStatus",
            'RETURNED_FOR_REWORK'::"SecretarySettingsDraftStatus"
        )
        AND "submittedAt" IS NOT NULL
        AND "reviewedAt" IS NOT NULL
        AND "reviewedByUserId" IS NOT NULL
    )
);