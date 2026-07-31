-- CreateEnum
CREATE TYPE "BookingAccessTokenPurpose" AS ENUM ('VIEW_AND_MANAGE_BOOKING', 'VIEW_ONLY');

-- CreateTable
CREATE TABLE "BookingAccessToken" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "purpose" "BookingAccessTokenPurpose" NOT NULL DEFAULT 'VIEW_AND_MANAGE_BOOKING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingAccessToken_tokenHash_key" ON "BookingAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingAccessToken_appointmentId_idx" ON "BookingAccessToken"("appointmentId");

-- CreateIndex
CREATE INDEX "BookingAccessToken_expiresAt_idx" ON "BookingAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "BookingAccessToken" ADD CONSTRAINT "BookingAccessToken_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
