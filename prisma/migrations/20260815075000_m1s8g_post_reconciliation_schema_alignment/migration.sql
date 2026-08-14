-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_createdByUserId_fkey";

-- DropIndex
DROP INDEX "Appointment_status_idx";

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "BookingDraftAnswer" RENAME CONSTRAINT "BookingDraftAnswer_member_parent_fkey" TO "BookingDraftAnswer_bookingDraftMemberId_bookingDraftId_fkey";

-- RenameForeignKey
ALTER TABLE "BookingDraftServiceSelection" RENAME CONSTRAINT "BookingDraftServiceSelection_member_parent_fkey" TO "BookingDraftServiceSelection_bookingDraftMemberId_bookingD_fkey";

-- RenameForeignKey
ALTER TABLE "SubscriptionCreditEntry" RENAME CONSTRAINT "SubscriptionCreditEntry_counterpartyDoctorFinancialAccountId_fk" TO "SubscriptionCreditEntry_counterpartyDoctorFinancialAccount_fkey";

-- RenameForeignKey
ALTER TABLE "SubscriptionEntitlementEvent" RENAME CONSTRAINT "SubscriptionEntitlementEvent_doctorSubscriptionEntitlementId_fk" TO "SubscriptionEntitlementEvent_doctorSubscriptionEntitlement_fkey";

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Appointment_mobile_scope_status_idx" RENAME TO "Appointment_mobileNumberHash_practiceLocationId_serviceDate_idx";

-- RenameIndex
ALTER INDEX "Appointment_queue_scope_order_idx" RENAME TO "Appointment_practiceLocationId_serviceDate_servingOrderKey_idx";

-- RenameIndex
ALTER INDEX "BookingDraft_mobileNumberHash_practiceLocationId_serviceDate_st" RENAME TO "BookingDraft_mobileNumberHash_practiceLocationId_serviceDat_idx";

-- RenameIndex
ALTER INDEX "BookingGroup_mobile_scope_idx" RENAME TO "BookingGroup_controllingMobileNumberHash_practiceLocationId_idx";
