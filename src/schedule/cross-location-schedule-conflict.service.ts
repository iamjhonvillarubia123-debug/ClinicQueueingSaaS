import { ConflictException, Injectable } from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { ScheduleResolutionService } from './schedule-resolution.service';

type ConflictClient = Pick<
  Prisma.TransactionClient,
  | 'practiceLocation'
  | 'scheduleException'
  | 'practiceSchedule'
  | 'doctorCalendarRule'
>;

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

@Injectable()
export class CrossLocationScheduleConflictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly doctorCalendar: DoctorCalendarAvailabilityService,
  ) {}

  async assertNoConflictForInterval(
    doctorProfileId: string,
    excludedPracticeLocationId: string,
    intervalStart: Date,
    intervalEnd: Date,
    transaction?: ConflictClient,
  ): Promise<void> {
    if (intervalEnd.getTime() <= intervalStart.getTime()) {
      throw new ConflictException('Clinic schedule interval is invalid.');
    }

    const db: ConflictClient = transaction ?? this.prisma;
    const otherLocations = await db.practiceLocation.findMany({
      where: {
        doctorProfileId,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        id: { not: excludedPracticeLocationId },
      },
      select: { id: true, timeZone: true },
      orderBy: { id: 'asc' },
    });

    for (const location of otherLocations) {
      const timeZone = location.timeZone?.trim();
      if (!timeZone) {
        throw new ConflictException(
          'An active practice location has no configured time zone.',
        );
      }

      const serviceDates = this.serviceDatesTouchedByInterval(
        intervalStart,
        intervalEnd,
        timeZone,
      );

      for (const serviceDate of serviceDates) {
        const resolved =
          await this.scheduleResolution.resolveConfiguredSchedule(
            location.id,
            serviceDate,
            db,
          );
        if (!resolved.isOpen || !resolved.opensAt || !resolved.closesAt) {
          continue;
        }

        const calendarAvailable =
          await this.doctorCalendar.isAvailableForInterval(
            doctorProfileId,
            resolved.opensAt,
            resolved.closesAt,
            db,
          );
        if (!calendarAvailable) {
          continue;
        }

        if (
          resolved.opensAt.getTime() < intervalEnd.getTime() &&
          intervalStart.getTime() < resolved.closesAt.getTime()
        ) {
          throw new ConflictException(
            'Clinic hours conflict with another active practice location.',
          );
        }
      }
    }
  }

  private serviceDatesTouchedByInterval(
    intervalStart: Date,
    intervalEnd: Date,
    timeZone: string,
  ): string[] {
    const start = this.localDateParts(intervalStart, timeZone);
    const inclusiveEnd = new Date(intervalEnd.getTime() - 1);
    const end = this.localDateParts(inclusiveEnd, timeZone);
    const dates: string[] = [];

    let cursor = start;
    while (this.dateKey(cursor) <= this.dateKey(end)) {
      dates.push(this.dateKey(cursor));
      cursor = this.addDays(cursor, 1);
    }
    return dates;
  }

  private localDateParts(instant: Date, timeZone: string): LocalDateParts {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(instant);
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value);
      return { year: get('year'), month: get('month'), day: get('day') };
    } catch {
      throw new ConflictException(
        'An active practice location has an invalid configured time zone.',
      );
    }
  }

  private addDays(date: LocalDateParts, days: number): LocalDateParts {
    const value = new Date(
      Date.UTC(date.year, date.month - 1, date.day + days),
    );
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  private dateKey(date: LocalDateParts): string {
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  }
}
