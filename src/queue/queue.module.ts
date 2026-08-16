import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ClinicDayCancellationService } from './clinic-day-cancellation.service';
import { QueueNumberAllocationService } from './queue-number-allocation.service';
import { SubstituteSecretaryController } from './substitute-secretary.controller';
import { SubstituteSecretaryService } from './substitute-secretary.service';

@Module({
  imports: [AuthModule, NotificationModule],
  providers: [
    ClinicDayCancellationService,
    QueueNumberAllocationService,
    SubstituteSecretaryService,
  ],
  controllers: [SubstituteSecretaryController],
  exports: [
    ClinicDayCancellationService,
    QueueNumberAllocationService,
    SubstituteSecretaryService,
  ],
})
export class QueueModule {}
