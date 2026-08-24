CREATE TABLE "SecretarySettingsDraftClinicDetails" (
    "id" TEXT NOT NULL,
    "secretarySettingsDraftId" TEXT NOT NULL,
    "proposedName" VARCHAR(200) NOT NULL,
    "proposedAddressLine1" VARCHAR(255) NOT NULL,
    "proposedAddressLine2" VARCHAR(255),
    "proposedCityMunicipality" VARCHAR(120) NOT NULL,
    "proposedProvince" VARCHAR(120) NOT NULL,
    "proposedPostalCode" VARCHAR(20),
    "proposedContactNumber" VARCHAR(30) NOT NULL,
    "proposedCountryCode" CHAR(2) NOT NULL,
    "proposedTimeZone" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecretarySettingsDraftClinicDetails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecretarySettingsDraftClinicDetails_secretarySettingsDraftId_key"
  ON "SecretarySettingsDraftClinicDetails"("secretarySettingsDraftId");

ALTER TABLE "SecretarySettingsDraftClinicDetails"
  ADD CONSTRAINT "SecretarySettingsDraftClinicDetails_secretarySettingsDraftId_fkey"
  FOREIGN KEY ("secretarySettingsDraftId") REFERENCES "SecretarySettingsDraft"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
