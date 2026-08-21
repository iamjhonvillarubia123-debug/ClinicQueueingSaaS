import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppointmentErasureService } from './appointment-erasure.service';
import { PrivacyRetentionService } from './privacy-retention.service';

@Module({
  imports: [PrismaModule],
  providers: [PrivacyRetentionService, AppointmentErasureService],
  exports: [PrivacyRetentionService, AppointmentErasureService],
})
export class PrivacyRetentionModule {}
