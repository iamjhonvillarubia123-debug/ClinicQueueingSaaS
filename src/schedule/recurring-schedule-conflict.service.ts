import { ConflictException, Injectable } from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LocalDateParts, ScheduleTimeService } from './schedule-time.service';

const RECURRENCE_CYCLE_START_YEAR = 2400;
const RECURRENCE_CYCLE_END_YEAR = 2799;
const PH_TIME_ZONE = 'Asia/Manila';

type RecurrenceClient = Pick<
  Prisma.TransactionClient,
  'practiceLocation' | 'practiceSchedule'
>;

type RecurringSchedule = {
  weekday: Weekday;
  opensAtLocal: Date;
  closesAtLocal: Date;
};

@Injectable()
export class RecurringScheduleConflictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async assertNoConflictForLocation(
    doctorProfileId: string,
    practiceLocationId: string,
    practiceLocationTimeZone: string,
    transaction?: RecurrenceClient,
  ): Promise<void> {
    const timeZone = this.canonicalTimeZone(practiceLocationTimeZone);

    const db: RecurrenceClient = transaction ?? this.prisma;
    const candidateSchedules = await this.loadOpenSchedules(
      db,
      practiceLocationId,
    );
    if (candidateSchedules.length === 0) {
      return;
    }

    this.assertRecurringWallTimesResolvable(candidateSchedules, timeZone);

    const otherLocations = await db.practiceLocation.findMany({
      where: {
        doctorProfileId,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        id: { not: practiceLocationId },
      },
      select: { id: true, timeZone: true },
      orderBy: { id: 'asc' },
    });

    for (const location of otherLocations) {
      if (!location.timeZone?.trim()) {
        throw new ConflictException(
          'An active practice location has no configured time zone.',
        );
      }
      const otherTimeZone = this.canonicalTimeZone(location.timeZone);

      const otherSchedules = await this.loadOpenSchedules(db, location.id);
      if (otherSchedules.length === 0) {
        continue;
      }

      if (timeZone === otherTimeZone) {
        this.assertSameTimeZoneSchedulesDoNotOverlap(
          candidateSchedules,
          otherSchedules,
        );
        continue;
      }

      this.assertDifferentTimeZoneSchedulesDoNotOverlap(
        candidateSchedules,
        timeZone,
        otherSchedules,
        otherTimeZone,
      );
    }
  }

  private async loadOpenSchedules(
    db: RecurrenceClient,
    practiceLocationId: string,
  ): Promise<RecurringSchedule[]> {
    const rows = await db.practiceSchedule.findMany({
      where: { practiceLocationId, isOpen: true },
      select: {
        weekday: true,
        opensAtLocal: true,
        closesAtLocal: true,
      },
      orderBy: { weekday: 'asc' },
    });

    return rows.map((row) => {
      if (!row.opensAtLocal || !row.closesAtLocal) {
        throw new ConflictException(
          'Every open recurring clinic schedule requires opening and closing times.',
        );
      }
      if (row.closesAtLocal.getTime() <= row.opensAtLocal.getTime()) {
        throw new ConflictException(
          'Every open recurring clinic schedule must close after opening.',
        );
      }
      return {
        weekday: row.weekday,
        opensAtLocal: row.opensAtLocal,
        closesAtLocal: row.closesAtLocal,
      };
    });
  }

  private assertSameTimeZoneSchedulesDoNotOverlap(
    candidateSchedules: RecurringSchedule[],
    otherSchedules: RecurringSchedule[],
  ): void {
    for (const candidate of candidateSchedules) {
      for (const other of otherSchedules) {
        if (candidate.weekday !== other.weekday) {
          continue;
        }
        if (
          this.localMinute(candidate.opensAtLocal) <
            this.localMinute(other.closesAtLocal) &&
          this.localMinute(other.opensAtLocal) <
            this.localMinute(candidate.closesAtLocal)
        ) {
          throw new ConflictException(
            'Recurring clinic hours conflict with another active practice location.',
          );
        }
      }
    }
  }

  private assertDifferentTimeZoneSchedulesDoNotOverlap(
    candidateSchedules: RecurringSchedule[],
    candidateTimeZone: string,
    otherSchedules: RecurringSchedule[],
    otherTimeZone: string,
  ): void {
    const schedulesByWeekday = new Map<string, RecurringSchedule>();
    for (const schedule of otherSchedules) {
      schedulesByWeekday.set(schedule.weekday, schedule);
    }

    for (const candidate of candidateSchedules) {
      let date = this.firstWeekdayOnOrAfter(
        { year: RECURRENCE_CYCLE_START_YEAR, month: 1, day: 1 },
        candidate.weekday,
      );

      while (date.year <= RECURRENCE_CYCLE_END_YEAR) {
        const candidateInterval = this.resolveRecurringInterval(
          date,
          candidate,
          candidateTimeZone,
        );
        const otherDates = this.localDatesTouchedByInterval(
          candidateInterval.start,
          candidateInterval.end,
          otherTimeZone,
        );

        for (const otherDate of otherDates) {
          const weekday = this.scheduleTime.weekday(otherDate);
          const other = schedulesByWeekday.get(weekday);
          if (!other) {
            continue;
          }

          const otherInterval = this.resolveRecurringInterval(
            otherDate,
            other,
            otherTimeZone,
          );
          if (
            candidateInterval.start.getTime() < otherInterval.end.getTime() &&
            otherInterval.start.getTime() < candidateInterval.end.getTime()
          ) {
            throw new ConflictException(
              'Recurring clinic hours conflict with another active practice location.',
            );
          }
        }

        date = this.addDays(date, 7);
      }
    }
  }

  private assertRecurringWallTimesResolvable(
    schedules: RecurringSchedule[],
    timeZone: string,
  ): void {
    if (timeZone === PH_TIME_ZONE) {
      return;
    }

    for (const schedule of schedules) {
      let date = this.firstWeekdayOnOrAfter(
        { year: RECURRENCE_CYCLE_START_YEAR, month: 1, day: 1 },
        schedule.weekday,
      );
      while (date.year <= RECURRENCE_CYCLE_END_YEAR) {
        this.resolveRecurringInterval(date, schedule, timeZone);
        date = this.addDays(date, 7);
      }
    }
  }

  private resolveRecurringInterval(
    date: LocalDateParts,
    schedule: RecurringSchedule,
    timeZone: string,
  ): { start: Date; end: Date } {
    try {
      return {
        start: this.scheduleTime.localDateTimeToInstant(
          date,
          this.scheduleTime.timeFromDatabase(schedule.opensAtLocal),
          timeZone,
        ),
        end: this.scheduleTime.localDateTimeToInstant(
          date,
          this.scheduleTime.timeFromDatabase(schedule.closesAtLocal),
          timeZone,
        ),
      };
    } catch {
      throw new ConflictException(
        'Recurring clinic hours contain a local time that is ambiguous or nonexistent in the configured time zone.',
      );
    }
  }

  private localDatesTouchedByInterval(
    intervalStart: Date,
    intervalEnd: Date,
    timeZone: string,
  ): LocalDateParts[] {
    const start = this.localDateParts(intervalStart, timeZone);
    const inclusiveEnd = new Date(intervalEnd.getTime() - 1);
    const end = this.localDateParts(inclusiveEnd, timeZone);
    const result: LocalDateParts[] = [];

    let cursor = start;
    while (this.dateKey(cursor) <= this.dateKey(end)) {
      result.push(cursor);
      cursor = this.addDays(cursor, 1);
    }
    return result;
  }

  private localDateParts(instant: Date, timeZone: string): LocalDateParts {
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
  }

  private firstWeekdayOnOrAfter(
    date: LocalDateParts,
    weekday: Weekday,
  ): LocalDateParts {
    const weekdayOrder = [
      Weekday.SUNDAY,
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
    ];
    const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
    const target = weekdayOrder.indexOf(weekday);
    const delta = (target - value.getUTCDay() + 7) % 7;
    return this.addDays(date, delta);
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

  private localMinute(value: Date): number {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }

  private dateKey(date: LocalDateParts): string {
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  }

  private canonicalTimeZone(timeZone: string): string {
    const trimmed = timeZone.trim();
    this.assertValidConfiguredTimeZone(trimmed);
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
  }

  private assertValidConfiguredTimeZone(timeZone: string): void {
    try {
      this.scheduleTime.assertValidTimeZone(timeZone);
    } catch {
      throw new ConflictException('Practice location time zone is invalid.');
    }
  }
}
