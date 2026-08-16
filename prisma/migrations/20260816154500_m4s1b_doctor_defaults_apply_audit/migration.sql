-- M4S1B DOCTOR DEFAULTS APPLY
--
-- Adds runtime BookingQuestion template provenance and narrow append-only
-- audit ownership for protected Doctor-wide defaults Apply commands.
-- Provenance is informational orchestration metadata only. Copied location
-- configuration remains independent after each Apply.

ALTER TABLE "BookingQuestion"
  ADD COLUMN "sourceDoctorBookingQuestionTemplateId" TEXT;

CREATE INDEX "BookingQuestion_sourceDoctorBookingQuestionTemplateId_idx"
  ON "BookingQuestion"("sourceDoctorBookingQuestionTemplateId");

CREATE TABLE "DoctorDefaultsApplyAudit" (
  "id" TEXT NOT NULL,
  "doctorProfileId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "commandIdempotencyId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorDefaultsApplyAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorDefaultsApplyAudit_commandIdempotencyId_key" UNIQUE ("commandIdempotencyId"),
  CONSTRAINT "DoctorDefaultsApplyAudit_doctorProfileId_fkey"
    FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DoctorDefaultsApplyAudit_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DoctorDefaultsApplyAudit_commandIdempotencyId_fkey"
    FOREIGN KEY ("commandIdempotencyId") REFERENCES "CommandIdempotency"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DoctorDefaultsApplyAudit_doctorProfile_occurred_idx"
  ON "DoctorDefaultsApplyAudit"("doctorProfileId", "occurredAt");
CREATE INDEX "DoctorDefaultsApplyAudit_actor_occurred_idx"
  ON "DoctorDefaultsApplyAudit"("actorUserId", "occurredAt");

CREATE TABLE "DoctorDefaultsApplyAuditTarget" (
  "id" TEXT NOT NULL,
  "doctorDefaultsApplyAuditId" TEXT NOT NULL,
  "practiceLocationId" TEXT NOT NULL,
  CONSTRAINT "DoctorDefaultsApplyAuditTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorDefaultsApplyAuditTarget_audit_location_key"
    UNIQUE ("doctorDefaultsApplyAuditId", "practiceLocationId"),
  CONSTRAINT "DoctorDefaultsApplyAuditTarget_audit_fkey"
    FOREIGN KEY ("doctorDefaultsApplyAuditId") REFERENCES "DoctorDefaultsApplyAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DoctorDefaultsApplyAuditTarget_location_fkey"
    FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DoctorDefaultsApplyAuditTarget_location_idx"
  ON "DoctorDefaultsApplyAuditTarget"("practiceLocationId");

CREATE TABLE "DoctorDefaultsApplyAuditItem" (
  "id" TEXT NOT NULL,
  "doctorDefaultsApplyAuditTargetId" TEXT NOT NULL,
  "itemKind" VARCHAR(30) NOT NULL,
  "sourceTemplateId" TEXT NOT NULL,
  "targetConfigurationId" TEXT NOT NULL,
  CONSTRAINT "DoctorDefaultsApplyAuditItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorDefaultsApplyAuditItem_kind_check"
    CHECK ("itemKind" IN ('SERVICE', 'BOOKING_QUESTION')),
  CONSTRAINT "DoctorDefaultsApplyAuditItem_target_template_key"
    UNIQUE ("doctorDefaultsApplyAuditTargetId", "itemKind", "sourceTemplateId"),
  CONSTRAINT "DoctorDefaultsApplyAuditItem_target_fkey"
    FOREIGN KEY ("doctorDefaultsApplyAuditTargetId") REFERENCES "DoctorDefaultsApplyAuditTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DoctorDefaultsApplyAuditItem_source_idx"
  ON "DoctorDefaultsApplyAuditItem"("itemKind", "sourceTemplateId");
CREATE INDEX "DoctorDefaultsApplyAuditItem_targetConfiguration_idx"
  ON "DoctorDefaultsApplyAuditItem"("targetConfigurationId");
