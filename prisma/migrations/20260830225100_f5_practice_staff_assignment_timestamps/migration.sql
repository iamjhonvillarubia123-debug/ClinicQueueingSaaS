-- Track the current effective PracticeStaff assignment period explicitly.
-- Existing rows inherit their historical creation/update timestamps as the
-- best available approximation for the pre-F5 assignment period.

ALTER TABLE "PracticeStaff"
  ADD COLUMN "activatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deactivatedAt" TIMESTAMPTZ(3);

UPDATE "PracticeStaff"
SET "activatedAt" = "createdAt";

UPDATE "PracticeStaff"
SET "deactivatedAt" = COALESCE("updatedAt", "createdAt")
WHERE "isActive" = FALSE;

ALTER TABLE "PracticeStaff"
  ALTER COLUMN "activatedAt" SET NOT NULL,
  ALTER COLUMN "activatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PracticeStaff"
  ADD CONSTRAINT "PracticeStaff_activation_shape_check" CHECK (
    ("isActive" = TRUE AND "deactivatedAt" IS NULL)
    OR
    ("isActive" = FALSE AND "deactivatedAt" IS NOT NULL)
  );

CREATE INDEX "PracticeStaff_location_active_activated_idx"
  ON "PracticeStaff" ("practiceLocationId", "isActive", "activatedAt");
