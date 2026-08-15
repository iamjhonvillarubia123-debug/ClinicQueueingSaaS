import { ConflictException, Injectable } from '@nestjs/common';
import {
  DoctorCalendarRecurrenceType,
  DoctorCalendarRuleStatus,
  Prisma,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LocalDateParts, ScheduleTimeService } from './schedule-time.service';

type CalendarClient = Pick<Prisma.TransactionClient, 'doctorCalendarRule'>;

type CalendarRule = {
  recurrenceType: DoctorCalendarRecurrenceType;
  startDate: Date;
  endDate: Date | null;
  timeZone: string;
  isWholeDay: boolean;
  startsAtLocal: Date | null;
  endsAtLocal: Date | null;
  monthlyDayOfMonth: number | null;
  weeklyWeekdays: Array<{ weekday: Weekday }>;
  occurrenceOverrides: Array<{
    occurrenceDate: Date;
    isAvailable: boolean;
  }>;
};

@Injectable()
export class DoctorCalendarAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async assertAvailableForInterval(
    doctorProfileId: string,
    intervalStart: Date,
    intervalEnd: Date,
    transaction?: CalendarClient,
  ): Promise<void> {
    const available = await this.isAvailableForInterval(
      doctorProfileId,
      intervalStart,
      intervalEnd,
      transaction,
    );
    if (!available) {
      throw new ConflictException(
        'Doctor Calendar unavailability overlaps the proposed clinic hours.',
      );
    }
  }

  async isAvailableForInterval(
    doctorProfileId: string,
    intervalStart: Date,
    intervalEnd: Date,
    transaction?: CalendarClient,
  ): Promise<boolean> {
    if (intervalEnd.getTime() <= intervalStart.getTime()) {
      throw new ConflictException('Clinic schedule interval is invalid.');
    }

    const db: CalendarClient = transaction ?? this.prisma;
    const rules = await db.doctorCalendarRule.findMany({
      where: {
        doctorProfileId,
        status: DoctorCalendarRuleStatus.ACTIVE,
      },
      select: {
        recurrenceType: true,
        startDate: true,
        endDate: true,
        timeZone: true,
        isWholeDay: true,
        startsAtLocal: true,
        endsAtLocal: true,
        monthlyDayOfMonth: true,
        weeklyWeekdays: { select: { weekday: true } },
        occurrenceOverrides: {
          select: { occurrenceDate: true, isAvailable: true },
        },
      },
    });

    for (const rule of rules) {
      this.scheduleTime.assertValidTimeZone(rule.timeZone);
      const candidateDates = this.calendarDatesTouchedByInterval(
        intervalStart,
        intervalEnd,
        rule.timeZone,
      );

      for (const candidateDate of candidateDates) {
        if (!this.ruleOccursOnDate(rule, candidateDate)) {
          continue;
        }
        if (this.isOccurrenceOverriddenAvailable(rule, candidateDate)) {
          continue;
        }

        const block = this.resolveBlock(rule, candidateDate);
        if (
          block.start.getTime() < intervalEnd.getTime() &&
          intervalStart.getTime() < block.end.getTime()
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private resolveBlock(
    rule: CalendarRule,
    date: LocalDateParts,
  ): { start: Date; end: Date } {
    if (rule.isWholeDay) {
      return {
        start: this.scheduleTime.localDateTimeToInstant(
          date,
          { hour: 0, minute: 0, second: 0 },
          rule.timeZone,
        ),
        end: this.scheduleTime.localDateTimeToInstant(
          this.addDays(date, 1),
          { hour: 0, minute: 0, second: 0 },
          rule.timeZone,
        ),
      };
    }

    if (!rule.startsAtLocal || !rule.endsAtLocal) {
      throw new ConflictException(
        'Partial-day Doctor Calendar rules require start and end times.',
      );
    }

    return {
      start: this.scheduleTime.localDateTimeToInstant(
        date,
        this.scheduleTime.timeFromDatabase(rule.startsAtLocal),
        rule.timeZone,
      ),
      end: this.scheduleTime.localDateTimeToInstant(
        date,
        this.scheduleTime.timeFromDatabase(rule.endsAtLocal),
        rule.timeZone,
      ),
    };
  }

  private ruleOccursOnDate(rule: CalendarRule, date: LocalDateParts): boolean {
    const key = this.dateKey(date);
    const startKey = this.databaseDateKey(rule.startDate);
    const endKey = rule.endDate ? this.databaseDateKey(rule.endDate) : null;

    if (key < startKey || (endKey && key > endKey)) {
      return false;
    }

    switch (rule.recurrenceType) {
      case DoctorCalendarRecurrenceType.SINGLE_DATE:
        return key === startKey;
      case DoctorCalendarRecurrenceType.DATE_RANGE:
      case DoctorCalendarRecurrenceType.DAILY:
        return true;
      case DoctorCalendarRecurrenceType.WEEKLY: {
        const weekday = this.scheduleTime.weekday(date);
        return rule.weeklyWeekdays.some((entry) => entry.weekday === weekday);
      }
      case DoctorCalendarRecurrenceType.MONTHLY_DATE:
        return rule.monthlyDayOfMonth === date.day;
    }
  }

  private isOccurrenceOverriddenAvailable(
    rule: CalendarRule,
    date: LocalDateParts,
  ): boolean {
    const key = this.dateKey(date);
    return rule.occurrenceOverrides.some(
      (override) =>
        override.isAvailable &&
        this.databaseDateKey(override.occurrenceDate) === key,
    );
  }

  private calendarDatesTouchedByInterval(
    intervalStart: Date,
    intervalEnd: Date,
    timeZone: string,
  ): LocalDateParts[] {
    const start = this.localDateParts(intervalStart, timeZone);
    const inclusiveEnd = new Date(intervalEnd.getTime() - 1);
    const end = this.localDateParts(inclusiveEnd, timeZone);
    const dates: LocalDateParts[] = [];

    let cursor = start;
    while (this.dateKey(cursor) <= this.dateKey(end)) {
      dates.push(cursor);
      cursor = this.addDays(cursor, 1);
    }
    return dates;
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

  private databaseDateKey(value: Date): string {
    return this.dateKey({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    });
  }
}
