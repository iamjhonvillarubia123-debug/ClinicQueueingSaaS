import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationPayloadService } from './notification-payload.service';

@Module({
  imports: [ConfigModule],
  providers: [NotificationPayloadService, NotificationOutboxClaimService],
  exports: [NotificationPayloadService, NotificationOutboxClaimService],
})
export class NotificationModule {}
