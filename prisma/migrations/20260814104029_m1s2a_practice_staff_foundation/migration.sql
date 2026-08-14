/*
  Warnings:

  - You are about to drop the column `isActive` on the `PracticeLocation` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[publicIdentifier]` on the table `PracticeLocation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[currentRegularPracticeStaffId]` on the table `PracticeLocation` will be added. If there are existing duplicate values, this will fail.
  - The required column `publicIdentifier` was added to the `PracticeLocation` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- CreateEnum
CREATE TYPE "PracticeLocationLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'PERMANENTLY_DELETED');

-- CreateEnum
CREATE TYPE "PracticeStaffCapabilityType" AS ENUM ('CANCEL_CLINIC_DAY');

-- CreateEnum
CREATE TYPE "PracticeStaffCapabilityStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- DropIndex
DROP INDEX "PracticeStaff_practiceLocationId_idx";

-- DropIndex
DROP INDEX "PracticeStaff_userId_idx";

-- AlterTable
-- Preserve the meaning of the legacy PracticeLocation.isActive flag while
-- moving to the canonical Phase 3 lifecycle. Existing TRUE rows become ACTIVE;
-- existing FALSE rows become DISABLED. New incomplete locations default DRAFT.
ALTER TABLE "PracticeLocation"
ADD COLUMN     "countryCode" CHAR(2),
ADD COLUMN     "currentRegularPracticeStaffId" TEXT,
ADD COLUMN     "lifecycleStatus" "PracticeLocationLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "publicIdentifier" VARCHAR(64),
ADD COLUMN     "timeZone" VARCHAR(100),
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "addressLine1" DROP NOT NULL,
ALTER COLUMN "cityMunicipality" DROP NOT NULL,
ALTER COLUMN "province" DROP NOT NULL,
ALTER COLUMN "contactNumber" DROP NOT NULL;

UPDATE "PracticeLocation"
SET "lifecycleStatus" = CASE
    WHEN "isActive" = TRUE THEN 'ACTIVE'::"PracticeLocationLifecycleStatus"
    ELSE 'DISABLED'::"PracticeLocationLifecycleStatus"
END;

-- Backfill a stable non-secret public identifier for pre-existing locations.
-- Prisma supplies UUID values for newly-created rows after this migration.
UPDATE "PracticeLocation"
SET "publicIdentifier" = gen_random_uuid()::text
WHERE "publicIdentifier" IS NULL;

ALTER TABLE "PracticeLocation"
ALTER COLUMN "publicIdentifier" SET NOT NULL,
DROP COLUMN "isActive";

-- CreateTable
CREATE TABLE "PracticeStaffCapability" (
    "id" TEXT NOT NULL,
    "practiceStaffId" TEXT NOT NULL,
    "capabilityType" "PracticeStaffCapabilityType" NOT NULL,
    "status" "PracticeStaffCapabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeCapabilityKey" VARCHAR(64),
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeStaffCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeStaffCapability_activeCapabilityKey_key" ON "PracticeStaffCapability"("activeCapabilityKey");

-- CreateIndex
CREATE INDEX "PracticeStaffCapability_practiceStaffId_status_idx" ON "PracticeStaffCapability"("practiceStaffId", "status");

-- CreateIndex
CREATE INDEX "PracticeStaffCapability_grantedByUserId_grantedAt_idx" ON "PracticeStaffCapability"("grantedByUserId", "grantedAt");

-- CreateIndex
CREATE INDEX "PracticeStaffCapability_revokedByUserId_revokedAt_idx" ON "PracticeStaffCapability"("revokedByUserId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLocation_publicIdentifier_key" ON "PracticeLocation"("publicIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLocation_currentRegularPracticeStaffId_key" ON "PracticeLocation"("currentRegularPracticeStaffId");

-- CreateIndex
CREATE INDEX "PracticeLocation_lifecycleStatus_idx" ON "PracticeLocation"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "PracticeLocation_doctorProfileId_lifecycleStatus_idx" ON "PracticeLocation"("doctorProfileId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "PracticeStaff_practiceLocationId_isActive_idx" ON "PracticeStaff"("practiceLocationId", "isActive");

-- CreateIndex
CREATE INDEX "PracticeStaff_userId_isActive_idx" ON "PracticeStaff"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "PracticeLocation" ADD CONSTRAINT "PracticeLocation_currentRegularPracticeStaffId_fkey" FOREIGN KEY ("currentRegularPracticeStaffId") REFERENCES "PracticeStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeStaffCapability" ADD CONSTRAINT "PracticeStaffCapability_practiceStaffId_fkey" FOREIGN KEY ("practiceStaffId") REFERENCES "PracticeStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeStaffCapability" ADD CONSTRAINT "PracticeStaffCapability_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeStaffCapability" ADD CONSTRAINT "PracticeStaffCapability_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S2A MANUAL POSTGRESQL CONSTRAINTS

-- Capability lifecycle must be internally consistent.
ALTER TABLE "PracticeStaffCapability"
ADD CONSTRAINT "PracticeStaffCapability_lifecycle_check"
CHECK (
    (
        "status" = 'ACTIVE'::"PracticeStaffCapabilityStatus"
        AND "activeCapabilityKey" IS NOT NULL
        AND "revokedAt" IS NULL
        AND "revokedByUserId" IS NULL
    )
    OR
    (
        "status" = 'REVOKED'::"PracticeStaffCapabilityStatus"
        AND "activeCapabilityKey" IS NULL
        AND "revokedAt" IS NOT NULL
        AND "revokedByUserId" IS NOT NULL
    )
);