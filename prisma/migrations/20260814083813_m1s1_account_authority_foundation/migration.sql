/*
  Warnings:

  - You are about to drop the column `isActive` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'VOLUNTARILY_DISABLED', 'PERMANENTLY_CLOSED');

-- CreateEnum
CREATE TYPE "AdministrativeRestrictionStatus" AS ENUM ('NONE', 'SUSPENDED', 'EMERGENCY_SUSPENDED');

-- CreateEnum
CREATE TYPE "AccountPermanentClosureType" AS ENUM ('DOCTOR_PERMANENT_CLOSURE', 'SECRETARY_PERMANENT_CLOSURE');

-- CreateEnum
CREATE TYPE "AdministrativeAccountActionType" AS ENUM ('NORMAL_SUSPENSION', 'NORMAL_RESTORATION', 'EMERGENCY_SUSPENSION', 'EMERGENCY_RESTORATION');

-- CreateEnum
CREATE TYPE "AdministrativeReasonCategory" AS ENUM ('SECURITY_CONCERN', 'SUSPECTED_FRAUD_OR_ABUSE', 'SERIOUS_POLICY_VIOLATION', 'ACCOUNT_COMPROMISE', 'LEGAL_REQUIREMENT', 'REGULATORY_REQUIREMENT', 'SERIOUS_PLATFORM_SAFETY');

-- CreateEnum
CREATE TYPE "ApplicationNotificationType" AS ENUM ('SECRETARY_ACCOUNT_DISABLED', 'SECRETARY_ACCOUNT_DELETED');

-- DropForeignKey
ALTER TABLE "DoctorAccountSettings" DROP CONSTRAINT "DoctorAccountSettings_doctorProfileId_fkey";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isActive",
ADD COLUMN     "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "administrativeRestrictionStatus" "AdministrativeRestrictionStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "middleName" VARCHAR(100);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorDataRetentionAcknowledgement" (
    "id" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "acknowledgementVersion" VARCHAR(50) NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorDataRetentionAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPermanentClosureAudit" (
    "id" TEXT NOT NULL,
    "accountUserId" TEXT NOT NULL,
    "initiatedByUserId" TEXT NOT NULL,
    "closureType" "AccountPermanentClosureType" NOT NULL,
    "previousAccountStatus" "UserAccountStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commandIdempotencyId" TEXT,

    CONSTRAINT "AccountPermanentClosureAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdministrativeAccountAction" (
    "id" TEXT NOT NULL,
    "actionType" "AdministrativeAccountActionType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetDoctorUserId" TEXT NOT NULL,
    "reasonCategory" "AdministrativeReasonCategory",
    "explanation" VARCHAR(1000),
    "resolutionText" VARCHAR(1000),
    "restoresActionId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdministrativeAccountAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdministrativeAccountActionScope" (
    "id" TEXT NOT NULL,
    "administrativeAccountActionId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "clinicDayId" TEXT,

    CONSTRAINT "AdministrativeAccountActionScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationNotification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "notificationType" "ApplicationNotificationType" NOT NULL,
    "affectedSecretaryUserId" TEXT,
    "practiceLocationId" TEXT,
    "notificationIdentityKey" CHAR(64) NOT NULL,
    "commandIdempotencyId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "ApplicationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DoctorDataRetentionAcknowledgement_doctorUserId_acknowledge_idx" ON "DoctorDataRetentionAcknowledgement"("doctorUserId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorDataRetentionAcknowledgement_doctorUserId_acknowledge_key" ON "DoctorDataRetentionAcknowledgement"("doctorUserId", "acknowledgementVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPermanentClosureAudit_accountUserId_key" ON "AccountPermanentClosureAudit"("accountUserId");

-- CreateIndex
CREATE INDEX "AccountPermanentClosureAudit_occurredAt_idx" ON "AccountPermanentClosureAudit"("occurredAt");

-- CreateIndex
CREATE INDEX "AccountPermanentClosureAudit_closureType_occurredAt_idx" ON "AccountPermanentClosureAudit"("closureType", "occurredAt");

-- CreateIndex
CREATE INDEX "AccountPermanentClosureAudit_commandIdempotencyId_idx" ON "AccountPermanentClosureAudit"("commandIdempotencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AdministrativeAccountAction_restoresActionId_key" ON "AdministrativeAccountAction"("restoresActionId");

-- CreateIndex
CREATE INDEX "AdministrativeAccountAction_targetDoctorUserId_occurredAt_idx" ON "AdministrativeAccountAction"("targetDoctorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AdministrativeAccountAction_actorUserId_occurredAt_idx" ON "AdministrativeAccountAction"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AdministrativeAccountAction_actionType_occurredAt_idx" ON "AdministrativeAccountAction"("actionType", "occurredAt");

-- CreateIndex
CREATE INDEX "AdministrativeAccountActionScope_administrativeAccountActio_idx" ON "AdministrativeAccountActionScope"("administrativeAccountActionId");

-- CreateIndex
CREATE INDEX "AdministrativeAccountActionScope_practiceLocationId_idx" ON "AdministrativeAccountActionScope"("practiceLocationId");

-- CreateIndex
CREATE INDEX "AdministrativeAccountActionScope_clinicDayId_idx" ON "AdministrativeAccountActionScope"("clinicDayId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationNotification_notificationIdentityKey_key" ON "ApplicationNotification"("notificationIdentityKey");

-- CreateIndex
CREATE INDEX "ApplicationNotification_recipientUserId_readAt_idx" ON "ApplicationNotification"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "ApplicationNotification_recipientUserId_createdAt_idx" ON "ApplicationNotification"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationNotification_affectedSecretaryUserId_idx" ON "ApplicationNotification"("affectedSecretaryUserId");

-- CreateIndex
CREATE INDEX "ApplicationNotification_practiceLocationId_idx" ON "ApplicationNotification"("practiceLocationId");

-- CreateIndex
CREATE INDEX "ApplicationNotification_commandIdempotencyId_idx" ON "ApplicationNotification"("commandIdempotencyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_current_nonterminal_key"
ON "User"("email")
WHERE "accountStatus" <> 'PERMANENTLY_CLOSED';

-- AddForeignKey
ALTER TABLE "DoctorAccountSettings" ADD CONSTRAINT "DoctorAccountSettings_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorDataRetentionAcknowledgement" ADD CONSTRAINT "DoctorDataRetentionAcknowledgement_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPermanentClosureAudit" ADD CONSTRAINT "AccountPermanentClosureAudit_accountUserId_fkey" FOREIGN KEY ("accountUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPermanentClosureAudit" ADD CONSTRAINT "AccountPermanentClosureAudit_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeAccountAction" ADD CONSTRAINT "AdministrativeAccountAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeAccountAction" ADD CONSTRAINT "AdministrativeAccountAction_targetDoctorUserId_fkey" FOREIGN KEY ("targetDoctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeAccountAction" ADD CONSTRAINT "AdministrativeAccountAction_restoresActionId_fkey" FOREIGN KEY ("restoresActionId") REFERENCES "AdministrativeAccountAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeAccountActionScope" ADD CONSTRAINT "AdministrativeAccountActionScope_administrativeAccountActi_fkey" FOREIGN KEY ("administrativeAccountActionId") REFERENCES "AdministrativeAccountAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeAccountActionScope" ADD CONSTRAINT "AdministrativeAccountActionScope_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNotification" ADD CONSTRAINT "ApplicationNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNotification" ADD CONSTRAINT "ApplicationNotification_affectedSecretaryUserId_fkey" FOREIGN KEY ("affectedSecretaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNotification" ADD CONSTRAINT "ApplicationNotification_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- M1S1 MANUAL POSTGRESQL CONSTRAINTS
-- These constraints implement stable same-row / uniqueness invariants from
-- the approved canonical Project Sources that Prisma schema syntax does not
-- fully express.

-- AccountPermanentClosureAudit is self-service: the initiator is the exact
-- account being permanently closed.
ALTER TABLE "AccountPermanentClosureAudit"
ADD CONSTRAINT "AccountPermanentClosureAudit_self_initiated_check"
CHECK ("initiatedByUserId" = "accountUserId");

-- Permanent closure may only originate from ACTIVE or VOLUNTARILY_DISABLED.
ALTER TABLE "AccountPermanentClosureAudit"
ADD CONSTRAINT "AccountPermanentClosureAudit_previous_status_check"
CHECK ("previousAccountStatus" IN ('ACTIVE', 'VOLUNTARILY_DISABLED'));

-- Administrative action row shape:
-- suspension rows require reason/explanation and no resolution/restoration;
-- restoration rows require resolution/restoration and no suspension reason.
ALTER TABLE "AdministrativeAccountAction"
ADD CONSTRAINT "AdministrativeAccountAction_shape_check"
CHECK (
    (
        "actionType" IN ('NORMAL_SUSPENSION', 'EMERGENCY_SUSPENSION')
        AND "reasonCategory" IS NOT NULL
        AND "explanation" IS NOT NULL
        AND "resolutionText" IS NULL
        AND "restoresActionId" IS NULL
    )
    OR
    (
        "actionType" IN ('NORMAL_RESTORATION', 'EMERGENCY_RESTORATION')
        AND "reasonCategory" IS NULL
        AND "explanation" IS NULL
        AND "resolutionText" IS NOT NULL
        AND "restoresActionId" IS NOT NULL
    )
);

-- Prevent duplicate emergency/admin scope rows when ClinicDay is present.
CREATE UNIQUE INDEX "AdministrativeAccountActionScope_exact_scope_key"
ON "AdministrativeAccountActionScope"(
    "administrativeAccountActionId",
    "practiceLocationId",
    "clinicDayId"
)
WHERE "clinicDayId" IS NOT NULL;

-- PostgreSQL ordinary UNIQUE treats NULLs as distinct. This separate partial
-- index prevents duplicate location-level scope rows where clinicDayId is NULL.
CREATE UNIQUE INDEX "AdministrativeAccountActionScope_location_scope_key"
ON "AdministrativeAccountActionScope"(
    "administrativeAccountActionId",
    "practiceLocationId"
)
WHERE "clinicDayId" IS NULL;

-- Both currently approved ApplicationNotification types are Secretary
-- lifecycle notices and require exact affected Secretary + PracticeLocation
-- context.
ALTER TABLE "ApplicationNotification"
ADD CONSTRAINT "ApplicationNotification_secretary_context_check"
CHECK (
    "affectedSecretaryUserId" IS NOT NULL
    AND "practiceLocationId" IS NOT NULL
);
