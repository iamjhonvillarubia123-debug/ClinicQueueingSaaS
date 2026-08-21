import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountAdministrativeRetentionService } from './account-administrative-retention.service';
import { AppointmentErasureService } from './appointment-erasure.service';
import { BackupErasureReplayService } from './backup-erasure-replay.service';
import { PrivacyRetentionService } from './privacy-retention.service';
import { SecurityRetentionCleanupService } from './security-retention-cleanup.service';

@Module({
  imports: [PrismaModule],
  providers: [
    PrivacyRetentionService,
    AppointmentErasureService,
    BackupErasureReplayService,
    SecurityRetentionCleanupService,
    AccountAdministrativeRetentionService,
  ],
  exports: [
    PrivacyRetentionService,
    AppointmentErasureService,
    BackupErasureReplayService,
    SecurityRetentionCleanupService,
    AccountAdministrativeRetentionService,
  ],
})
export class PrivacyRetentionModule {}
