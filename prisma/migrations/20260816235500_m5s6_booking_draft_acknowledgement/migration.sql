ALTER TABLE "BookingDraft"
  ADD COLUMN "privacyNoticeAcknowledgedAt" TIMESTAMPTZ(3),
  ADD COLUMN "privacyNoticeVersion" VARCHAR(50),
  ADD COLUMN "scheduledReminderOptIn" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BookingDraft"
  ADD CONSTRAINT "BookingDraft_privacy_acknowledgement_pair_check"
  CHECK (
    ("privacyNoticeAcknowledgedAt" IS NULL AND "privacyNoticeVersion" IS NULL)
    OR
    ("privacyNoticeAcknowledgedAt" IS NOT NULL AND "privacyNoticeVersion" IS NOT NULL)
  );
