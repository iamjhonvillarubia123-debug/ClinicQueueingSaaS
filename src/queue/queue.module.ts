import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ClinicDayCancellationService } from './clinic-day-cancellation.service';
import { NextPatientController } from './next-patient.controller';
import { NextPatientService } from './next-patient.service';
import { QueueNumberAllocationService } from './queue-number-allocation.service';
import { QueueServingOrderPlacementService } from './queue-serving-order-placement.service';
import { ReturnToQueueController } from './return-to-queue.controller';
import { ReturnToQueueService } from './return-to-queue.service';
import { StartClinicController } from './start-clinic.controller';
import { StartClinicService } from './start-clinic.service';
import { SubstituteSecretaryController } from './substitute-secretary.controller';
import { SubstituteSecretaryService } from './substitute-secretary.service';

@Module({
  imports: [
    AuthModule,
    IdempotencyModule,
    NotificationModule,
    PrismaModule,
    ScheduleModule,
  ],
  providers: [
    ClinicDayCancellationService,
    NextPatientService,
    QueueNumberAllocationService,
    QueueServingOrderPlacementService,
    ReturnToQueueService,
    StartClinicService,
    SubstituteSecretaryService,
  ],
  controllers: [
    NextPatientController,
    ReturnToQueueController,
    StartClinicController,
    SubstituteSecretaryController,
  ],
  exports: [
    ClinicDayCancellationService,
    NextPatientService,
    QueueNumberAllocationService,
    QueueServingOrderPlacementService,
    ReturnToQueueService,
    StartClinicService,
    SubstituteSecretaryService,
  ],
})
export class QueueModule {}
