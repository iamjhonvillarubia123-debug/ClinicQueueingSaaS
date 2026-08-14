-- M1S8H - Doctor stable public-route identity foundation.
--
-- Approved invariant:
-- - one stable Doctor-level public identifier;
-- - separate from internal database ids and presentation slug;
-- - opaque, collision-resistant and automatically created;
-- - immutable for the lifetime of the Doctor public resource;
-- - never reassigned to another Doctor.
--
-- Existing DoctorProfile rows require a staged backfill because Prisma's
-- uuid() default is application-level and cannot populate an already non-empty
-- PostgreSQL table while adding a required column.
--
-- gen_random_uuid() is used only to backfill existing rows. New rows continue
-- to receive Prisma's application-level uuid() default from schema.prisma.

-- 1. Add nullable column temporarily so existing DoctorProfile rows remain valid.
ALTER TABLE "DoctorProfile"
  ADD COLUMN "publicIdentifier" VARCHAR(64);

-- 2. Backfill every existing DoctorProfile with an independently generated,
-- opaque UUID string.
UPDATE "DoctorProfile"
SET "publicIdentifier" = gen_random_uuid()::text
WHERE "publicIdentifier" IS NULL;

-- 3. Defensive migration-time assertions before tightening the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DoctorProfile"
    WHERE "publicIdentifier" IS NULL
  ) THEN
    RAISE EXCEPTION 'M1S8H backfill failed: DoctorProfile.publicIdentifier remains NULL';
  END IF;

  IF EXISTS (
    SELECT "publicIdentifier"
    FROM "DoctorProfile"
    GROUP BY "publicIdentifier"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'M1S8H backfill failed: duplicate DoctorProfile.publicIdentifier values exist';
  END IF;
END
$$;

-- 4. Final canonical required/unique shape.
ALTER TABLE "DoctorProfile"
  ALTER COLUMN "publicIdentifier" SET NOT NULL;

CREATE UNIQUE INDEX "DoctorProfile_publicIdentifier_key"
  ON "DoctorProfile"("publicIdentifier");