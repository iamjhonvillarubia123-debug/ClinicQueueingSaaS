import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrossLocationScheduleConflictService } from './cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';

export type PublicServiceDateAvailabilityReason =
  | 'AVAILABLE'
  | 'LOCATION_UNAVAILABLE'
  | 'NO_OPEN_SCHEDULE'
  | 'DOCTOR_CALENDAR_UNAVAILABLE'
  | 'CROSS_LOCATION_CONFLICT'
  | 'CLINIC_DAY_NOT_ACCEPTING_PUBLIC_BOOKING'
  | 'PUBLIC_BOOKING_CUTOFF_REACHED';

export type PublicServiceDateAvailability = {
  practiceLocationId: string;
  serviceDate: string;
  availableForPublicBooking: boolean;
  reason: PublicServiceDateAvailabilityReason;
  scheduleSource:
    | ('SCHEDULE_EXCEPTION' | 'PRACTICE_SCHEDULE' | 'NO_SCHEDULE')
    | null;
  opensAt: Date | null;
  closesAt: Date | null;
  maximumOnlineBookingUntilAt: Date | null;
  maximumOperatingUntilAt: Date | null;
};

type AvailabilityClient = Pick<
  Prisma.TransactionClient,
  | 'practiceLocation'
  | 'scheduleException'
  | 'practiceSchedule'
  | 'doctorCalendarRule'
  | 'clinicDay'
>;

@Injectable()
export class PublicServiceDateAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly doctorCalendar: DoctorCalendarAvailabilityService,
    private readonly crossLocationConflict: CrossLocationScheduleConflictService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async resolve(
    practiceLocationId: string,
    serviceDate: string,
    now: Date = new Date(),
    transaction?: AvailabilityClient,
  ): Promise<PublicServiceDateAvailability> {
    const db: AvailabilityClient = transaction ?? this.prisma;
    const parsedDate = this.scheduleTime.parseServiceDate(serviceDate);
    const dateValue = new Date(
      Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day),
    );

    const location = await db.practiceLocation.findUnique({
      where: { id: practiceLocationId },
      select: {
        id: true,
        doctorProfileId: true,
        lifecycleStatus: true,
        isBookingEnabled: true,
        doctorProfile: {
          select: {
            accountSettings: {
              select: { allowOnlineBooking: true },
            },
          },
        },
      },
    });
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }

    if (
      location.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE ||
      !location.isBookingEnabled ||
      location.doctorProfile.accountSettings?.allowOnlineBooking !== true
    ) {
      return this.unavailable(
        practiceLocationId,
        serviceDate,
        'LOCATION_UNAVAILABLE',
      );
    }

    const schedule = await this.scheduleResolution.resolveConfiguredSchedule(
      practiceLocationId,
      serviceDate,
      db,
    );
    if (!schedule.isOpen || !schedule.opensAt || !schedule.closesAt) {
      return {
        practiceLocationId,
        serviceDate,
        availableForPublicBooking: false,
        reason: 'NO_OPEN_SCHEDULE',
        scheduleSource: schedule.source,
        opensAt: null,
        closesAt: null,
        maximumOnlineBookingUntilAt: null,
        maximumOperatingUntilAt: null,
      };
    }

    const calendarAvailable = await this.doctorCalendar.isAvailableForInterval(
      location.doctorProfileId,
      schedule.opensAt,
      schedule.closesAt,
      db,
    );
    if (!calendarAvailable) {
      return this.fromSchedule(
        schedule,
        false,
        'DOCTOR_CALENDAR_UNAVAILABLE',
        schedule.maximumOnlineBookingUntilAt,
      );
    }

    try {
      await this.crossLocationConflict.assertNoConflictForInterval(
        location.doctorProfileId,
        practiceLocationId,
        schedule.opensAt,
        schedule.closesAt,
        db,
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      return this.fromSchedule(
        schedule,
        false,
        'CROSS_LOCATION_CONFLICT',
        schedule.maximumOnlineBookingUntilAt,
      );
    }

    const clinicDay = await db.clinicDay.findUnique({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue,
        },
      },
      select: {
        status: true,
        maximumOnlineBookingUntilAt: true,
      },
    });
    if (clinicDay?.status === 'CANCELLED' || clinicDay?.status === 'CLOSED') {
      return this.fromSchedule(
        schedule,
        false,
        'CLINIC_DAY_NOT_ACCEPTING_PUBLIC_BOOKING',
        clinicDay.maximumOnlineBookingUntilAt ??
          schedule.maximumOnlineBookingUntilAt,
      );
    }

    const effectiveCutoff =
      clinicDay?.maximumOnlineBookingUntilAt ??
      schedule.maximumOnlineBookingUntilAt;
    if (effectiveCutoff && now.getTime() >= effectiveCutoff.getTime()) {
      return this.fromSchedule(
        schedule,
        false,
        'PUBLIC_BOOKING_CUTOFF_REACHED',
        effectiveCutoff,
      );
    }

    return this.fromSchedule(schedule, true, 'AVAILABLE', effectiveCutoff);
  }

  private unavailable(
    practiceLocationId: string,
    serviceDate: string,
    reason: PublicServiceDateAvailabilityReason,
  ): PublicServiceDateAvailability {
    return {
      practiceLocationId,
      serviceDate,
      availableForPublicBooking: false,
      reason,
      scheduleSource: null,
      opensAt: null,
      closesAt: null,
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    };
  }

  private fromSchedule(
    schedule: Awaited<
      ReturnType<ScheduleResolutionService['resolveConfiguredSchedule']>
    >,
    availableForPublicBooking: boolean,
    reason: PublicServiceDateAvailabilityReason,
    maximumOnlineBookingUntilAt: Date | null,
  ): PublicServiceDateAvailability {
    return {
      practiceLocationId: schedule.practiceLocationId,
      serviceDate: schedule.serviceDate,
      availableForPublicBooking,
      reason,
      scheduleSource: schedule.source,
      opensAt: schedule.opensAt,
      closesAt: schedule.closesAt,
      maximumOnlineBookingUntilAt,
      maximumOperatingUntilAt: schedule.maximumOperatingUntilAt,
    };
  }
}
