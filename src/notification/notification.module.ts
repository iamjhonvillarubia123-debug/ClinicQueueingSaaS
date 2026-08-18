import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationDeliveryAttemptService } from './notification-delivery-attempt.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationPayloadService } from './notification-payload.service';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
  ],
  exports: [
    NotificationPayloadService,
    NotificationOutboxClaimService,
    NotificationDeliveryAttemptService,
  ],
})
export class NotificationModule {}
