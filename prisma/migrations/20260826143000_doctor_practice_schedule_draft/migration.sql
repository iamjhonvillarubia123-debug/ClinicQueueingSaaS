CREATE TABLE "DoctorPracticeScheduleDraft" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DoctorPracticeScheduleDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DoctorPracticeScheduleDraftRow" (
    "id" TEXT NOT NULL,
    "doctorPracticeScheduleDraftId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "opensAtLocal" TIME(0),
    "closesAtLocal" TIME(0),
    "maximumOnlineBookingUntilLocal" TIME(0),
    "maximumOperatingUntilLocal" TIME(0),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DoctorPracticeScheduleDraftRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DoctorPracticeScheduleDraft_practiceLocationId_key" ON "DoctorPracticeScheduleDraft"("practiceLocationId");
CREATE UNIQUE INDEX "DoctorPracticeScheduleDraftRow_doctorPracticeScheduleDraftId_weekday_key" ON "DoctorPracticeScheduleDraftRow"("doctorPracticeScheduleDraftId", "weekday");
CREATE INDEX "DoctorPracticeScheduleDraftRow_doctorPracticeScheduleDraftId_idx" ON "DoctorPracticeScheduleDraftRow"("doctorPracticeScheduleDraftId");

ALTER TABLE "DoctorPracticeScheduleDraft" ADD CONSTRAINT "DoctorPracticeScheduleDraft_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DoctorPracticeScheduleDraftRow" ADD CONSTRAINT "DoctorPracticeScheduleDraftRow_doctorPracticeScheduleDraftId_fkey" FOREIGN KEY ("doctorPracticeScheduleDraftId") REFERENCES "DoctorPracticeScheduleDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
