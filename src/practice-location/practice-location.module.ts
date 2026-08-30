import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { PracticeLocationActivationService } from './practice-location-activation.service';
import { PracticeLocationConfigurationApplyService } from './practice-location-configuration-apply.service';
import { PracticeLocationConfigurationDraftService } from './practice-location-configuration-draft.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';
import { PracticeLocationDraftScheduleService } from './practice-location-draft-schedule.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationProtectedActivationService } from './practice-location-protected-activation.service';
import { PracticeLocationService } from './practice-location.service';
import { PracticeSchedulePreflightService } from './practice-schedule-preflight.service';
import { PracticeLocationController } from './practice-location.controller';
import { PracticeLocationOperationsService } from './practice-location-operations.service';

@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule],
  providers: [
    PracticeLocationService,
    PracticeLocationActivationService,
    PracticeLocationProtectedActivationService,
    PracticeLocationConfigurationApplyService,
    PracticeLocationConfigurationDraftService,
    PracticeLocationDataRetentionGateService,
    PracticeLocationDraftScheduleService,
    PracticeLocationLifecycleService,
    PracticeLocationPermanentDeleteService,
    PracticeSchedulePreflightService,
    PracticeLocationOperationsService,
  ],
  controllers: [PracticeLocationController],
})
export class PracticeLocationModule {}
