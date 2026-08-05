-- CreateEnum
CREATE TYPE "PracticeStaffRole" AS ENUM ('SECRETARY');

-- CreateTable
CREATE TABLE "PracticeStaff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "staffRole" "PracticeStaffRole" NOT NULL DEFAULT 'SECRETARY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeStaff_userId_idx" ON "PracticeStaff"("userId");

-- CreateIndex
CREATE INDEX "PracticeStaff_practiceLocationId_idx" ON "PracticeStaff"("practiceLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeStaff_userId_practiceLocationId_key" ON "PracticeStaff"("userId", "practiceLocationId");
