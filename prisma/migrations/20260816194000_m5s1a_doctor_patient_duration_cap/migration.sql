ALTER TABLE "DoctorAccountSettings"
ADD COLUMN "maximumEstimatedServiceMinutesPerPatient" INTEGER;

ALTER TABLE "DoctorAccountSettings"
ADD CONSTRAINT "DoctorAccountSettings_maximumEstimatedServiceMinutesPerPatient_check"
CHECK (
  "maximumEstimatedServiceMinutesPerPatient" IS NULL
  OR (
    "maximumEstimatedServiceMinutesPerPatient" >= 1
    AND "maximumEstimatedServiceMinutesPerPatient" <= 4320
  )
);
