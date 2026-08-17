import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { ScheduleTimeService } from './schedule-time.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdvanceBookingWindowService {
  constructor(private readonly scheduleTime: ScheduleTimeService) {}

  isSelectable(
    serviceDate: string,
    timeZone: string,
    maximumAdvanceBookingDays: number,
    now = new Date(),
  ): boolean {
    if (
      !Number.isInteger(maximumAdvanceBookingDays) ||
      maximumAdvanceBookingDays < 0
    ) {
      throw new InternalServerErrorException(
        'Maximum advance booking configuration is invalid.',
      );
    }

    this.scheduleTime.assertValidTimeZone(timeZone);
    const requested = this.scheduleTime.parseServiceDate(serviceDate);
    const current = this.currentDateInTimeZone(now, timeZone);
    const requestedDay = Date.UTC(
      requested.year,
      requested.month - 1,
      requested.day,
    );
    const currentDay = Date.UTC(current.year, current.month - 1, current.day);
    const latestDay = currentDay + maximumAdvanceBookingDays * DAY_MS;

    return requestedDay >= currentDay && requestedDay <= latestDay;
  }

  private currentDateInTimeZone(instant: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
    };
  }
}
