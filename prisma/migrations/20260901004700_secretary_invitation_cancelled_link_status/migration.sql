-- Preserve the one-way token hash after revocation so an invitation link can
-- report that it was cancelled. The active key remains cleared, therefore a
-- revoked invitation cannot be accepted or treated as pending.
ALTER TABLE "SecretaryInvitation"
  DROP CONSTRAINT "SecretaryInvitation_status_shape_check";

ALTER TABLE "SecretaryInvitation"
  ADD CONSTRAINT "SecretaryInvitation_status_shape_check"
  CHECK (
    ("status" = 'PENDING' AND "tokenHash" IS NOT NULL AND "activeInvitationKey" IS NOT NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACCEPTED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NOT NULL AND "acceptedUserId" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL AND "revokedAt" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "tokenHash" IS NULL AND "activeInvitationKey" IS NULL AND "acceptedAt" IS NULL AND "acceptedUserId" IS NULL)
  );
