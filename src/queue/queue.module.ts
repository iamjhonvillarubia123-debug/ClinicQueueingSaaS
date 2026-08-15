import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ClinicDayCancellationService } from './clinic-day-cancellation.service';

@Module({
  imports: [NotificationModule],
  providers: [ClinicDayCancellationService],
  exports: [ClinicDayCancellationService],
})
export class QueueModule {}
