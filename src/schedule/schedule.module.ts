import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';

@Module({
  imports: [PrismaModule],
  providers: [ScheduleTimeService, ScheduleResolutionService],
  exports: [ScheduleTimeService, ScheduleResolutionService],
})
export class ScheduleModule {}
