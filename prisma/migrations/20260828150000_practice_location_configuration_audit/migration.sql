CREATE TABLE "PracticeLocationConfigurationAudit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "practiceLocationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "commandIdempotencyId" UUID,
    "actionType" VARCHAR(50) NOT NULL,
    "changedSections" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeLocationConfigurationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeLocationConfigurationAudit_commandIdempotencyId_key"
ON "PracticeLocationConfigurationAudit"("commandIdempotencyId")
WHERE "commandIdempotencyId" IS NOT NULL;

CREATE INDEX "PracticeLocationConfigurationAudit_location_occurred_idx"
ON "PracticeLocationConfigurationAudit"("practiceLocationId", "occurredAt");

CREATE INDEX "PracticeLocationConfigurationAudit_actor_occurred_idx"
ON "PracticeLocationConfigurationAudit"("actorUserId", "occurredAt");

ALTER TABLE "PracticeLocationConfigurationAudit"
ADD CONSTRAINT "PracticeLocationConfigurationAudit_practiceLocationId_fkey"
FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PracticeLocationConfigurationAudit"
ADD CONSTRAINT "PracticeLocationConfigurationAudit_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PracticeLocationConfigurationAudit"
ADD CONSTRAINT "PracticeLocationConfigurationAudit_commandIdempotencyId_fkey"
FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
