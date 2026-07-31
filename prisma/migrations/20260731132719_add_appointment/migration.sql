-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'WAITING', 'CALLED', 'NOW_SERVING', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "AppointmentCancelledByType" AS ENUM ('PATIENT', 'DOCTOR', 'SECRETARY', 'SYSTEM');

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "bookingReference" VARCHAR(20) NOT NULL,
    "patientId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "scheduledStartAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledEndAt" TIMESTAMPTZ(3) NOT NULL,
    "estimatedServiceMinutes" INTEGER NOT NULL,
    "queueNumber" INTEGER,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "mobileVerifiedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "arrivedAt" TIMESTAMPTZ(3),
    "calledAt" TIMESTAMPTZ(3),
    "serviceStartedAt" TIMESTAMPTZ(3),
    "serviceCompletedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledByType" "AppointmentCancelledByType",
    "cancellationReason" VARCHAR(255),
    "expiredAt" TIMESTAMPTZ(3),
    "noShowMarkedAt" TIMESTAMPTZ(3),
    "createdByUserId" TEXT,
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_bookingReference_key" ON "Appointment"("bookingReference");

-- CreateIndex
CREATE INDEX "Appointment_practiceLocationId_scheduledStartAt_idx" ON "Appointment"("practiceLocationId", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "Appointment_practiceLocationId_status_scheduledStartAt_idx" ON "Appointment"("practiceLocationId", "status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_practiceLocationId_scheduledStartAt_queueNumber_key" ON "Appointment"("practiceLocationId", "scheduledStartAt", "queueNumber");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
