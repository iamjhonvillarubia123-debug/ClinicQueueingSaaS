import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { ApplicationNotificationController } from './application-notification.controller';
import { ApplicationNotificationService } from './application-notification.service';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationOtpPayloadPurgeService } from './notification-otp-payload-purge.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';
import { NotificationPayloadService } from './notification-payload.service';
import { NotificationProtectedPayloadPurgeService } from './notification-protected-payload-purge.service';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';
import { ScheduledReminderCancellationService } from './scheduled-reminder-cancellation.service';
import { ScheduledReminderHandoffService } from './scheduled-reminder-handoff.service';

@Module({
  imports: [AuthModule, ConfigModule, MobileNumberModule],
  controllers: [ApplicationNotificationController],
  providers: [
    ApplicationNotificationService,
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationProtectedPayloadPurgeService,
    NotificationOtpPayloadPurgeService,
    NotificationProviderContractService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    ScheduledReminderCancellationService,
    ScheduledReminderHandoffService,
  ],
  exports: [
    ApplicationNotificationService,
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationProtectedPayloadPurgeService,
    NotificationOtpPayloadPurgeService,
    NotificationProviderContractService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    ScheduledReminderCancellationService,
    ScheduledReminderHandoffService,
  ],
})
export class NotificationModule {}
