-- M1S3C PRISMA / POSTGRESQL RELATION SYNCHRONIZATION
--
-- The preceding M1S3C integrity migration added composite foreign keys that
-- make member ownership parent-safe. Prisma now models those same composite
-- relations directly, so the older redundant single-column member foreign
-- keys are removed. The composite keys continue to enforce member existence
-- and same-parent integrity.

ALTER TABLE "BookingDraftAnswer"
DROP CONSTRAINT "BookingDraftAnswer_bookingDraftMemberId_fkey";

ALTER TABLE "BookingDraftServiceSelection"
DROP CONSTRAINT "BookingDraftServiceSelection_bookingDraftMemberId_fkey";
