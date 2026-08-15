import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ScheduleTimeService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
  ],
  exports: [
    ScheduleTimeService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
  ],
})
export class ScheduleModule {}
