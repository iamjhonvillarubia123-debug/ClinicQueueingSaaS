import { BadRequestException } from '@nestjs/common';
import { ScheduleTimeService } from './schedule-time.service';

describe('ScheduleTimeService', () => {
  const service = new ScheduleTimeService();

  it('converts a clinic-local Manila time to the correct instant', () => {
    const instant = service.localDateTimeToInstant(
      { year: 2026, month: 8, day: 16 },
      { hour: 9, minute: 0, second: 0 },
      'Asia/Manila',
    );
    expect(instant.toISOString()).toBe('2026-08-16T01:00:00.000Z');
  });

  it('rejects a nonexistent DST local time', () => {
    expect(() =>
      service.localDateTimeToInstant(
        { year: 2026, month: 3, day: 8 },
        { hour: 2, minute: 30, second: 0 },
        'America/New_York',
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an ambiguous DST local time', () => {
    expect(() =>
      service.localDateTimeToInstant(
        { year: 2026, month: 11, day: 1 },
        { hour: 1, minute: 30, second: 0 },
        'America/New_York',
      ),
    ).toThrow(BadRequestException);
  });

  it('derives weekday independently of server local time', () => {
    expect(service.weekday({ year: 2026, month: 8, day: 16 })).toBe('SUNDAY');
  });
});
