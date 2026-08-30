-- Presentation-only Service ordering.
-- This order controls display only and must not affect queue priority,
-- booking priority, Service-selection semantics, or estimated workload.

ALTER TABLE "PracticeLocationService"
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "practiceLocationId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) - 1 AS "displayOrder"
  FROM "PracticeLocationService"
)
UPDATE "PracticeLocationService" service
SET "displayOrder" = ranked."displayOrder"
FROM ranked
WHERE service."id" = ranked."id";

CREATE INDEX "PracticeLocationService_practiceLocationId_displayOrder_idx"
ON "PracticeLocationService"("practiceLocationId", "displayOrder");

ALTER TABLE "SecretarySettingsDraftService"
ADD COLUMN "proposedDisplayOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "SecretarySettingsDraftService" proposal
SET "proposedDisplayOrder" = service."displayOrder"
FROM "PracticeLocationService" service
WHERE proposal."practiceLocationServiceId" = service."id";

WITH new_proposals AS (
  SELECT
    proposal."id",
    COALESCE(current_services."maxDisplayOrder", -1)
      + ROW_NUMBER() OVER (
          PARTITION BY draft."practiceLocationId"
          ORDER BY proposal."createdAt" ASC, proposal."id" ASC
        ) AS "displayOrder"
  FROM "SecretarySettingsDraftService" proposal
  INNER JOIN "SecretarySettingsDraft" draft
    ON draft."id" = proposal."secretarySettingsDraftId"
  LEFT JOIN (
    SELECT "practiceLocationId", MAX("displayOrder") AS "maxDisplayOrder"
    FROM "PracticeLocationService"
    GROUP BY "practiceLocationId"
  ) current_services
    ON current_services."practiceLocationId" = draft."practiceLocationId"
  WHERE proposal."practiceLocationServiceId" IS NULL
)
UPDATE "SecretarySettingsDraftService" proposal
SET "proposedDisplayOrder" = new_proposals."displayOrder"
FROM new_proposals
WHERE proposal."id" = new_proposals."id";
