-- CreateTable
CREATE TABLE "DoctorAccountSettings" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "defaultTimeZone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
    "defaultConsultationMinutes" INTEGER NOT NULL DEFAULT 30,
    "maximumAdvanceBookingDays" INTEGER NOT NULL DEFAULT 30,
    "allowOnlineBooking" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorAccountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorAccountSettings_doctorProfileId_key" ON "DoctorAccountSettings"("doctorProfileId");

-- AddForeignKey
ALTER TABLE "DoctorAccountSettings" ADD CONSTRAINT "DoctorAccountSettings_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
