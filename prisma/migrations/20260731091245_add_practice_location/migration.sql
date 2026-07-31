-- CreateTable
CREATE TABLE "PracticeLocation" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "addressLine1" VARCHAR(255) NOT NULL,
    "addressLine2" VARCHAR(255),
    "cityMunicipality" VARCHAR(120) NOT NULL,
    "province" VARCHAR(120) NOT NULL,
    "postalCode" VARCHAR(20),
    "contactNumber" VARCHAR(30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeLocation_doctorProfileId_idx" ON "PracticeLocation"("doctorProfileId");

-- AddForeignKey
ALTER TABLE "PracticeLocation" ADD CONSTRAINT "PracticeLocation_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
