import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { PracticeLocationActivationService } from './practice-location-activation.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';
import { PracticeLocationDraftScheduleService } from './practice-location-draft-schedule.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationService } from './practice-location.service';
import { PracticeSchedulePreflightService } from './practice-schedule-preflight.service';
import { PracticeLocationController } from './practice-location.controller';

@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule],
  providers: [
    PracticeLocationService,
    PracticeLocationActivationService,
    PracticeLocationDataRetentionGateService,
    PracticeLocationDraftScheduleService,
    PracticeLocationLifecycleService,
    PracticeLocationPermanentDeleteService,
    PracticeSchedulePreflightService,
  ],
  controllers: [PracticeLocationController],
})
export class PracticeLocationModule {}
