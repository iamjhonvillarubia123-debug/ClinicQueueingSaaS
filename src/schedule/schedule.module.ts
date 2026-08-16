import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CrossLocationScheduleConflictService } from './cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { RecurringScheduleConflictService } from './recurring-schedule-conflict.service';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ScheduleTimeService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
    CrossLocationScheduleConflictService,
    RecurringScheduleConflictService,
  ],
  exports: [
    ScheduleTimeService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
    CrossLocationScheduleConflictService,
    RecurringScheduleConflictService,
  ],
})
export class ScheduleModule {}
