ALTER TABLE "BookingDraft"
ADD COLUMN "draftControlTokenHash" VARCHAR(64);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_draftControlTokenHash_format_check"
CHECK (
  "draftControlTokenHash" IS NULL
  OR "draftControlTokenHash" ~ '^[0-9a-f]{64}$'
);

CREATE UNIQUE INDEX "BookingDraft_draftControlTokenHash_key"
ON "BookingDraft"("draftControlTokenHash")
WHERE "draftControlTokenHash" IS NOT NULL;
