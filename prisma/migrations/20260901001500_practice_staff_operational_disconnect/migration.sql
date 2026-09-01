ALTER TABLE "PracticeStaff"
ADD COLUMN "disconnectedAt" TIMESTAMPTZ(3);

CREATE INDEX "PracticeStaff_location_disconnected_idx"
ON "PracticeStaff"("practiceLocationId", "disconnectedAt");
