-- Presentation-only ordering for clinic services.
-- This ordering affects display only and does not change queue priority,
-- appointment priority, booking eligibility, or service-selection semantics.

ALTER TABLE "PracticeLocationService"
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SecretarySettingsDraftService"
ADD COLUMN "proposedDisplayOrder" INTEGER NOT NULL DEFAULT 0;

-- Preserve a deterministic initial order for existing effective services.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "practiceLocationId"
      ORDER BY "createdAt", "id"
    ) - 1 AS "displayOrder"
  FROM "PracticeLocationService"
)
UPDATE "PracticeLocationService" AS service
SET "displayOrder" = ranked."displayOrder"
FROM ranked
WHERE service."id" = ranked."id";

-- For existing draft proposals, inherit the effective service order where possible.
UPDATE "SecretarySettingsDraftService" AS proposal
SET "proposedDisplayOrder" = service."displayOrder"
FROM "PracticeLocationService" AS service
WHERE proposal."practiceLocationServiceId" = service."id";

-- Assign deterministic positions to draft-only new-service proposals after
-- the highest effective/proposed position already present in each draft.
WITH new_proposals AS (
  SELECT
    p."id",
    p."secretarySettingsDraftId",
    ROW_NUMBER() OVER (
      PARTITION BY p."secretarySettingsDraftId"
      ORDER BY p."createdAt", p."id"
    ) - 1 AS rn
  FROM "SecretarySettingsDraftService" p
  WHERE p."practiceLocationServiceId" IS NULL
),
base_positions AS (
  SELECT
    d."id" AS "draftId",
    COALESCE(MAX(existing."proposedDisplayOrder"), -1) + 1 AS base
  FROM "SecretarySettingsDraft" d
  LEFT JOIN "SecretarySettingsDraftService" existing
    ON existing."secretarySettingsDraftId" = d."id"
   AND existing."practiceLocationServiceId" IS NOT NULL
  GROUP BY d."id"
)
UPDATE "SecretarySettingsDraftService" AS proposal
SET "proposedDisplayOrder" = base_positions.base + new_proposals.rn
FROM new_proposals
JOIN base_positions
  ON base_positions."draftId" = new_proposals."secretarySettingsDraftId"
WHERE proposal."id" = new_proposals."id";

CREATE INDEX "PracticeLocationService_practiceLocationId_displayOrder_idx"
ON "PracticeLocationService"("practiceLocationId", "displayOrder");
