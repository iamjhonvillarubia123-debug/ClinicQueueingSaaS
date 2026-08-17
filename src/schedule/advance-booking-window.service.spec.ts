import { ScheduleTimeService } from './schedule-time.service';
import { AdvanceBookingWindowService } from './advance-booking-window.service';

describe('AdvanceBookingWindowService', () => {
  const service = new AdvanceBookingWindowService(new ScheduleTimeService());
  const now = new Date('2026-08-17T03:30:00.000Z');

  it('allows the inclusive clinic-local upper boundary', () => {
    expect(service.isSelectable('2026-09-16', 'Asia/Manila', 30, now)).toBe(
      true,
    );
  });

  it('rejects the first date beyond the inclusive upper boundary', () => {
    expect(service.isSelectable('2026-09-17', 'Asia/Manila', 30, now)).toBe(
      false,
    );
  });

  it('treats zero as same-day only in the clinic time zone', () => {
    expect(service.isSelectable('2026-08-17', 'Asia/Manila', 0, now)).toBe(
      true,
    );
    expect(service.isSelectable('2026-08-18', 'Asia/Manila', 0, now)).toBe(
      false,
    );
  });

  it('uses clinic-local date rather than UTC date', () => {
    const nearMidnightUtc = new Date('2026-08-16T16:30:00.000Z');

    expect(
      service.isSelectable('2026-08-17', 'Asia/Manila', 0, nearMidnightUtc),
    ).toBe(true);
  });
});
