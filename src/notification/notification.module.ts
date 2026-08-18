import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';
import { NotificationPayloadService } from './notification-payload.service';

@Module({
  imports: [ConfigModule, MobileNumberModule],
  providers: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationDeliveryWorkerService,
  ],
  exports: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
    NotificationOutboxReconciliationService,
    NotificationDeliveryWorkerService,
  ],
})
export class NotificationModule {}
