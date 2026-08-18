import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';
import { NotificationPayloadService } from './notification-payload.service';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
  ],
  exports: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
  ],
})
export class NotificationModule {}
