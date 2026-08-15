import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationPayloadService } from './notification-payload.service';

@Module({
  imports: [ConfigModule],
  providers: [NotificationPayloadService],
  exports: [NotificationPayloadService],
})
export class NotificationModule {}
