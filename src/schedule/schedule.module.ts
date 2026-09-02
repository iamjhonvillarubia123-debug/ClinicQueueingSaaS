import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdvanceBookingWindowService } from './advance-booking-window.service';
import { CrossLocationScheduleConflictService } from './cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { PublicServiceDateAvailabilityService } from './public-service-date-availability.service';
import { RecurringScheduleConflictService } from './recurring-schedule-conflict.service';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';
import { DoctorCalendarController } from './doctor-calendar.controller';
import { DoctorCalendarWorkspaceService } from './doctor-calendar-workspace.service';

@Module({
  imports: [PrismaModule],
  controllers: [DoctorCalendarController],
  providers: [
    ScheduleTimeService,
    AdvanceBookingWindowService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
    CrossLocationScheduleConflictService,
    RecurringScheduleConflictService,
    PublicServiceDateAvailabilityService,
    DoctorCalendarWorkspaceService,
  ],
  exports: [
    ScheduleTimeService,
    AdvanceBookingWindowService,
    ScheduleResolutionService,
    DoctorCalendarAvailabilityService,
    CrossLocationScheduleConflictService,
    RecurringScheduleConflictService,
    PublicServiceDateAvailabilityService,
  ],
})
export class ScheduleModule {}
