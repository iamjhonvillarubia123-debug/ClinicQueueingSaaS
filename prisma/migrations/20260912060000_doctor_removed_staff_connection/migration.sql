ALTER TABLE "PracticeStaff" ADD COLUMN "removedByDoctorAt" TIMESTAMPTZ(3);
-- Existing self-disconnections have a durable actor notification in the same transaction.
UPDATE "PracticeStaff" ps SET "removedByDoctorAt" = ps."disconnectedAt"
WHERE ps."disconnectedAt" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "ApplicationNotification" n
  WHERE n."affectedSecretaryUserId" = ps."userId"
    AND n."sourceActorUserId" = ps."userId"
    AND n."practiceLocationId" = ps."practiceLocationId"
    AND n."title" = 'Secretary disconnected from clinic'
    AND n."createdAt" BETWEEN ps."disconnectedAt" - INTERVAL '1 minute' AND ps."disconnectedAt" + INTERVAL '1 minute'
);
