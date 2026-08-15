import { BadRequestException, Injectable } from '@nestjs/common';

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

export type LocalTimeParts = {
  hour: number;
  minute: number;
  second: number;
};

@Injectable()
export class ScheduleTimeService {
  assertValidTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
      throw new BadRequestException('Practice location time zone is invalid.');
    }
  }

  parseServiceDate(serviceDate: string): LocalDateParts {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
    if (!match) {
      throw new BadRequestException('Service Date must use YYYY-MM-DD.');
    }

    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
    const candidate = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    );
    if (
      candidate.getUTCFullYear() !== parts.year ||
      candidate.getUTCMonth() + 1 !== parts.month ||
      candidate.getUTCDate() !== parts.day
    ) {
      throw new BadRequestException('Service Date is invalid.');
    }
    return parts;
  }

  timeFromDatabase(value: Date): LocalTimeParts {
    return {
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
    };
  }

  localDateTimeToInstant(
    date: LocalDateParts,
    time: LocalTimeParts,
    timeZone: string,
  ): Date {
    this.assertValidTimeZone(timeZone);
    const targetUtcLike = Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      time.hour,
      time.minute,
      time.second,
    );
    let candidateMs = targetUtcLike;

    for (let index = 0; index < 4; index += 1) {
      const rendered = this.partsInTimeZone(new Date(candidateMs), timeZone);
      const renderedUtcLike = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second,
      );
      candidateMs += targetUtcLike - renderedUtcLike;
    }

    const candidate = new Date(candidateMs);
    if (!this.matches(candidate, date, time, timeZone)) {
      throw new BadRequestException(
        'Local schedule time does not exist in the configured time zone.',
      );
    }

    for (const offsetMinutes of [-120, -60, 60, 120]) {
      const alternate = new Date(candidateMs + offsetMinutes * 60_000);
      if (this.matches(alternate, date, time, timeZone)) {
        throw new BadRequestException(
          'Local schedule time is ambiguous in the configured time zone.',
        );
      }
    }

    return candidate;
  }

  weekday(
    serviceDate: LocalDateParts,
  ):
    | 'SUNDAY'
    | 'MONDAY'
    | 'TUESDAY'
    | 'WEDNESDAY'
    | 'THURSDAY'
    | 'FRIDAY'
    | 'SATURDAY' {
    const names = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ] as const;
    return names[
      new Date(
        Date.UTC(serviceDate.year, serviceDate.month - 1, serviceDate.day),
      ).getUTCDay()
    ];
  }

  private matches(
    instant: Date,
    date: LocalDateParts,
    time: LocalTimeParts,
    timeZone: string,
  ): boolean {
    const rendered = this.partsInTimeZone(instant, timeZone);
    return (
      rendered.year === date.year &&
      rendered.month === date.month &&
      rendered.day === date.day &&
      rendered.hour === time.hour &&
      rendered.minute === time.minute &&
      rendered.second === time.second
    );
  }

  private partsInTimeZone(instant: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }
}
