import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PatientBookingAccessController } from './patient-booking-access.controller';
import { PatientBookingAccessService } from './patient-booking-access.service';
import { PatientBookingGroupAccessController } from './patient-booking-group-access.controller';
import { PatientBookingGroupAccessService } from './patient-booking-group-access.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    PatientBookingAccessController,
    PatientBookingGroupAccessController,
  ],
  providers: [PatientBookingAccessService, PatientBookingGroupAccessService],
  exports: [PatientBookingAccessService, PatientBookingGroupAccessService],
})
export class PatientAccessModule {}
