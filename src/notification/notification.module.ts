import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';
import { NotificationPayloadService } from './notification-payload.service';
import { NotificationProtectedPayloadPurgeService } from './notification-protected-payload-purge.service';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';
import { ScheduledReminderCancellationService } from './scheduled-reminder-cancellation.service';

@Module({
  imports: [ConfigModule, MobileNumberModule],
  providers: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationProtectedPayloadPurgeService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    ScheduledReminderCancellationService,
  ],
  exports: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationProtectedPayloadPurgeService,
    NotificationSubmissionBoundaryService,
    NotificationDeliveryWorkerService,
    ScheduledReminderCancellationService,
  ],
})
export class NotificationModule {}
