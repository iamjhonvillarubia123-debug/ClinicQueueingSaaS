import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinancialModule } from '../financial/financial.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { PatientAccessModule } from '../patient-access/patient-access.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { CancelAppointmentController } from './cancel-appointment.controller';
import { CancelAppointmentService } from './cancel-appointment.service';
import { ClinicDayCancellationService } from './clinic-day-cancellation.service';
import { ClinicDayOperationalNoticeController } from './clinic-day-operational-notice.controller';
import { ClinicDayOperationalNoticeService } from './clinic-day-operational-notice.service';
import { CloseClinicController } from './close-clinic.controller';
import { CloseClinicService } from './close-clinic.service';
import { ImHereController } from './im-here.controller';
import { ImHereService } from './im-here.service';
import { NextPatientController } from './next-patient.controller';
import { NextPatientService } from './next-patient.service';
import { QueueNumberAllocationService } from './queue-number-allocation.service';
import { QueueServingOrderPlacementService } from './queue-serving-order-placement.service';
import { ReturnToQueueController } from './return-to-queue.controller';
import { ReturnToQueueService } from './return-to-queue.service';
import { StaffReinsertController } from './staff-reinsert.controller';
import { StaffReinsertService } from './staff-reinsert.service';
import { StartClinicController } from './start-clinic.controller';
import { StartClinicService } from './start-clinic.service';
import { SubstituteSecretaryController } from './substitute-secretary.controller';
import { SubstituteSecretaryService } from './substitute-secretary.service';
import { UndoQueueController } from './undo-queue.controller';
import { UndoQueueService } from './undo-queue.service';

@Module({
  imports: [
    AuthModule,
    FinancialModule,
    IdempotencyModule,
    NotificationModule,
    PatientAccessModule,
    PrismaModule,
    ScheduleModule,
  ],
  providers: [
    CancelAppointmentService,
    ClinicDayCancellationService,
    ClinicDayOperationalNoticeService,
    CloseClinicService,
    ImHereService,
    NextPatientService,
    QueueNumberAllocationService,
    QueueServingOrderPlacementService,
    ReturnToQueueService,
    StaffReinsertService,
    StartClinicService,
    SubstituteSecretaryService,
    UndoQueueService,
  ],
  controllers: [
    CancelAppointmentController,
    ClinicDayOperationalNoticeController,
    CloseClinicController,
    ImHereController,
    NextPatientController,
    ReturnToQueueController,
    StaffReinsertController,
    StartClinicController,
    SubstituteSecretaryController,
    UndoQueueController,
  ],
  exports: [
    CancelAppointmentService,
    ClinicDayCancellationService,
    ClinicDayOperationalNoticeService,
    CloseClinicService,
    ImHereService,
    NextPatientService,
    QueueNumberAllocationService,
    QueueServingOrderPlacementService,
    ReturnToQueueService,
    StaffReinsertService,
    StartClinicService,
    SubstituteSecretaryService,
    UndoQueueService,
  ],
})
export class QueueModule {}
