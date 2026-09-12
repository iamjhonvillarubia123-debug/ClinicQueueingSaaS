-- R3 reconciliation: Doctor professional profile fields are optional for clinic ownership/activation.
-- A verified active Doctor may own and activate a clinic without first publishing/completing
-- professional profile information. Clinic activation readiness remains schedule-driven.

ALTER TABLE "DoctorProfile"
  ALTER COLUMN "professionalTitle" DROP NOT NULL,
  ALTER COLUMN "specialization" DROP NOT NULL,
  ALTER COLUMN "licenseNumber" DROP NOT NULL;
