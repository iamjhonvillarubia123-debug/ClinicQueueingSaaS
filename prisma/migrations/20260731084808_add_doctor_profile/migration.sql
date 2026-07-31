-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "middleName" VARCHAR(100),
    "suffix" VARCHAR(30),
    "professionalTitle" VARCHAR(50) NOT NULL,
    "specialization" VARCHAR(150) NOT NULL,
    "licenseNumber" VARCHAR(100) NOT NULL,
    "profileDescription" TEXT,
    "profilePhotoUrl" VARCHAR(500),
    "publicSlug" VARCHAR(120),
    "isProfilePublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_userId_key" ON "DoctorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_licenseNumber_key" ON "DoctorProfile"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_publicSlug_key" ON "DoctorProfile"("publicSlug");

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
