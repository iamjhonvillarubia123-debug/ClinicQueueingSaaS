ALTER TABLE "BookingDraft"
ALTER COLUMN "bookingReference" DROP NOT NULL;

ALTER TABLE "BookingDraft"
ADD COLUMN "expiredAt" TIMESTAMPTZ(3),
ADD COLUMN "protectedDataClearedAt" TIMESTAMPTZ(3);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_expiredAt_status_check"
CHECK (
  ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL)
  OR ("status" <> 'EXPIRED' AND "expiredAt" IS NULL)
);

ALTER TABLE "BookingDraft"
ADD CONSTRAINT "BookingDraft_protected_cleanup_check"
CHECK (
  "protectedDataClearedAt" IS NULL
  OR (
    "bookingReference" IS NULL
    AND "existingPatientResponse" IS NULL
    AND "firstName" IS NULL
    AND "middleName" IS NULL
    AND "lastName" IS NULL
    AND "suffix" IS NULL
    AND "mobileNumberEncrypted" IS NULL
    AND "mobileNumberHash" IS NULL
    AND "mobileNumberLastFour" IS NULL
    AND "draftControlTokenHash" IS NULL
  )
);

CREATE INDEX "BookingDraft_terminal_cleanup_idx"
ON "BookingDraft"(
  "status",
  "protectedDataClearedAt",
  "consumedAt",
  "expiredAt",
  "cancelledAt"
);
