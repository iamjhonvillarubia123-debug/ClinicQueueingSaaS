import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppointmentErasureService } from './appointment-erasure.service';
import { PrivacyRetentionService } from './privacy-retention.service';
import { SecurityRetentionCleanupService } from './security-retention-cleanup.service';

@Module({
  imports: [PrismaModule],
  providers: [
    PrivacyRetentionService,
    AppointmentErasureService,
    SecurityRetentionCleanupService,
  ],
  exports: [
    PrivacyRetentionService,
    AppointmentErasureService,
    SecurityRetentionCleanupService,
  ],
})
export class PrivacyRetentionModule {}
