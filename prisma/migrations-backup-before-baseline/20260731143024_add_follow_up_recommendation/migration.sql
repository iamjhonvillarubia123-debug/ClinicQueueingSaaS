-- CreateEnum
CREATE TYPE "FollowUpRecommendationStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "FollowUpRecommendation" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "recommendedByUserId" TEXT NOT NULL,
    "recommendedFollowUpDate" DATE NOT NULL,
    "reminderScheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "FollowUpRecommendationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "shortNote" VARCHAR(150),
    "sentAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowUpRecommendation_appointmentId_idx" ON "FollowUpRecommendation"("appointmentId");

-- CreateIndex
CREATE INDEX "FollowUpRecommendation_status_reminderScheduledAt_idx" ON "FollowUpRecommendation"("status", "reminderScheduledAt");

-- AddForeignKey
ALTER TABLE "FollowUpRecommendation" ADD CONSTRAINT "FollowUpRecommendation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRecommendation" ADD CONSTRAINT "FollowUpRecommendation_recommendedByUserId_fkey" FOREIGN KEY ("recommendedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
