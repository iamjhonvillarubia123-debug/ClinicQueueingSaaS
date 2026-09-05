-- F5 Secretary authority bundles and Substitute Secretary coverage foundation.
-- Approved authority: 2026-08-30 F5 consolidated normative gate.

CREATE TYPE "PracticeStaffAuthorityBundleType" AS ENUM (
  'QUEUE_AND_CLINIC_DAY_OPERATIONS',
  'APPOINTMENTS_AND_PATIENT_INTAKE',
  'CLINIC_CONFIGURATION_DRAFTING',
  'REPORTS_VIEW_ONLY'
);

CREATE TYPE "PracticeStaffAuthorityBundleStatus" AS ENUM (
  'ACTIVE',
  'REVOKED'
);

CREATE TYPE "SubstituteSecretaryCoverageMode" AS ENUM (
  'ONE_SERVICE_DATE',
  'DATE_RANGE'
);

CREATE TYPE "SubstituteSecretaryCoverageStatus" AS ENUM (
  'ACTIVE',
  'CANCELLED',
  'SUPERSEDED',
  'EXPIRED'
);

ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'PRACTICE_STAFF_UPDATE_AUTHORITY_BUNDLES';
ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE';
ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'PRACTICE_LOCATION_REPLACE_SUBSTITUTE_COVERAGE';
ALTER TYPE "CommandType" ADD VALUE IF NOT EXISTS 'PRACTICE_LOCATION_CANCEL_SUBSTITUTE_COVERAGE';

CREATE TABLE "PracticeStaffAuthorityBundle" (
  "id" TEXT NOT NULL,
  "practiceStaffId" TEXT NOT NULL,
  "bundleType" "PracticeStaffAuthorityBundleType" NOT NULL,
  "status" "PracticeStaffAuthorityBundleStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedByUserId" TEXT NOT NULL,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PracticeStaffAuthorityBundle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeStaffAuthorityBundle_practiceStaffId_fkey"
    FOREIGN KEY ("practiceStaffId") REFERENCES "PracticeStaff"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PracticeStaffAuthorityBundle_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PracticeStaffAuthorityBundle_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PracticeStaffAuthorityBundle_revocation_shape_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL)
    OR
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "PracticeStaffAuthorityBundle_one_active_per_type"
  ON "PracticeStaffAuthorityBundle" ("practiceStaffId", "bundleType")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "PracticeStaffAuthorityBundle_staff_status_idx"
  ON "PracticeStaffAuthorityBundle" ("practiceStaffId", "status");

CREATE INDEX "PracticeStaffAuthorityBundle_granted_actor_idx"
  ON "PracticeStaffAuthorityBundle" ("grantedByUserId", "grantedAt");

CREATE INDEX "PracticeStaffAuthorityBundle_revoked_actor_idx"
  ON "PracticeStaffAuthorityBundle" ("revokedByUserId", "revokedAt");

CREATE TABLE "SubstituteSecretaryCoverage" (
  "id" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "practiceStaffId" TEXT NOT NULL,
  "coverageMode" "SubstituteSecretaryCoverageMode" NOT NULL,
  "fromServiceDate" DATE NOT NULL,
  "toServiceDate" DATE NOT NULL,
  "status" "SubstituteSecretaryCoverageStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedByUserId" TEXT,
  "endedAt" TIMESTAMPTZ(3),
  "supersedesCoverageId" TEXT,

  CONSTRAINT "SubstituteSecretaryCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubstituteSecretaryCoverage_practiceLocationId_fkey"
    FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverage_practiceStaffId_fkey"
    FOREIGN KEY ("practiceStaffId") REFERENCES "PracticeStaff"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverage_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverage_endedByUserId_fkey"
    FOREIGN KEY ("endedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverage_supersedesCoverageId_fkey"
    FOREIGN KEY ("supersedesCoverageId") REFERENCES "SubstituteSecretaryCoverage"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverage_date_order_check" CHECK (
    "fromServiceDate" <= "toServiceDate"
  ),
  CONSTRAINT "SubstituteSecretaryCoverage_mode_shape_check" CHECK (
    ("coverageMode" = 'ONE_SERVICE_DATE' AND "fromServiceDate" = "toServiceDate")
    OR
    ("coverageMode" = 'DATE_RANGE' AND "fromServiceDate" <= "toServiceDate")
  ),
  CONSTRAINT "SubstituteSecretaryCoverage_end_shape_check" CHECK (
    ("status" = 'ACTIVE' AND "endedAt" IS NULL AND "endedByUserId" IS NULL)
    OR
    ("status" IN ('CANCELLED', 'SUPERSEDED') AND "endedAt" IS NOT NULL AND "endedByUserId" IS NOT NULL)
    OR
    ("status" = 'EXPIRED' AND "endedAt" IS NOT NULL AND "endedByUserId" IS NULL)
  )
);

CREATE INDEX "SubstituteSecretaryCoverage_location_status_dates_idx"
  ON "SubstituteSecretaryCoverage" (
    "practiceLocationId", "status", "fromServiceDate", "toServiceDate"
  );

CREATE INDEX "SubstituteSecretaryCoverage_staff_status_dates_idx"
  ON "SubstituteSecretaryCoverage" (
    "practiceStaffId", "status", "fromServiceDate", "toServiceDate"
  );

CREATE INDEX "SubstituteSecretaryCoverage_created_actor_idx"
  ON "SubstituteSecretaryCoverage" ("createdByUserId", "createdAt");

CREATE INDEX "SubstituteSecretaryCoverage_ended_actor_idx"
  ON "SubstituteSecretaryCoverage" ("endedByUserId", "endedAt");

CREATE TABLE "SubstituteSecretaryCoverageDate" (
  "id" TEXT NOT NULL,
  "coverageId" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "status" "SubstituteSecretaryCoverageStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMPTZ(3),

  CONSTRAINT "SubstituteSecretaryCoverageDate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubstituteSecretaryCoverageDate_coverageId_fkey"
    FOREIGN KEY ("coverageId") REFERENCES "SubstituteSecretaryCoverage"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverageDate_practiceLocationId_fkey"
    FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubstituteSecretaryCoverageDate_end_shape_check" CHECK (
    ("status" = 'ACTIVE' AND "endedAt" IS NULL)
    OR
    ("status" <> 'ACTIVE' AND "endedAt" IS NOT NULL)
  )
);

-- This is the database backstop for the F5 rule that only one effective
-- planned Substitute Secretary may cover a PracticeLocation + Service Date.
CREATE UNIQUE INDEX "SubstituteSecretaryCoverageDate_one_active_per_location_date"
  ON "SubstituteSecretaryCoverageDate" ("practiceLocationId", "serviceDate")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "SubstituteSecretaryCoverageDate_coverage_date_unique"
  ON "SubstituteSecretaryCoverageDate" ("coverageId", "serviceDate");

CREATE INDEX "SubstituteSecretaryCoverageDate_coverage_status_idx"
  ON "SubstituteSecretaryCoverageDate" ("coverageId", "status");

CREATE INDEX "SubstituteSecretaryCoverageDate_location_date_status_idx"
  ON "SubstituteSecretaryCoverageDate" (
    "practiceLocationId", "serviceDate", "status"
  );
