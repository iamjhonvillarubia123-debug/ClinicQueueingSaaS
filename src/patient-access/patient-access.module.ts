import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PatientBookingAccessController } from './patient-booking-access.controller';
import { PatientBookingAccessService } from './patient-booking-access.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PatientBookingAccessController],
  providers: [PatientBookingAccessService],
  exports: [PatientBookingAccessService],
})
export class PatientAccessModule {}
