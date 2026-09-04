import { Module } from '@nestjs/common';
import { AccountAnnouncementController } from './account-announcement.controller';
import { AccountAnnouncementService } from './account-announcement.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { ApplicationNotificationController } from './application-notification.controller';
import { ApplicationNotificationService } from './application-notification.service';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationDeliveryPayloadResolverService } from './notification-delivery-payload-resolver.service';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationOtpPayloadPurgeService } from './notification-otp-payload-purge.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';
import { NotificationPayloadService } from './notification-payload.service';
import { NotificationProtectedPayloadPurgeService } from './notification-protected-payload-purge.service';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationReconciliationWorkerService } from './notification-reconciliation-worker.service';
import { NotificationRetentionCleanupService } from './notification-retention-cleanup.service';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';
import { OtpNotificationOutboxService } from './otp-notification-outbox.service';
import { PhilSmsNotificationProviderAdapter } from './philsms-notification-provider.adapter';
import { ScheduledReminderCancellationService } from './scheduled-reminder-cancellation.service';
import { ScheduledReminderHandoffService } from './scheduled-reminder-handoff.service';

@Module({
  imports: [AuthModule, ConfigModule, MobileNumberModule],
  controllers: [
    ApplicationNotificationController,
    AccountAnnouncementController,
  ],
  providers: [
    AccountAnnouncementService,
    ApplicationNotificationService,
    NotificationPayloadService,
    OtpNotificationOutboxService,
    NotificationDeliveryPayloadResolverService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationReconciliationWorkerService,
    NotificationProtectedPayloadPurgeService,
    NotificationOtpPayloadPurgeService,
    NotificationProviderContractService,
    NotificationRetentionCleanupService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    PhilSmsNotificationProviderAdapter,
    ScheduledReminderCancellationService,
    ScheduledReminderHandoffService,
  ],
  exports: [
    ApplicationNotificationService,
    NotificationPayloadService,
    OtpNotificationOutboxService,
    NotificationDeliveryPayloadResolverService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationReconciliationWorkerService,
    NotificationProtectedPayloadPurgeService,
    NotificationOtpPayloadPurgeService,
    NotificationProviderContractService,
    NotificationRetentionCleanupService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    PhilSmsNotificationProviderAdapter,
    ScheduledReminderCancellationService,
    ScheduledReminderHandoffService,
  ],
})
export class NotificationModule {}
