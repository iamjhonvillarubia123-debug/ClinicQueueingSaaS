import { BadRequestException } from '@nestjs/common';
import { SubscriptionPeriodService } from './subscription-period.service';

describe('SubscriptionPeriodService', () => {
  const service = new SubscriptionPeriodService();

  it('starts the first paid period at successful activation', () => {
    const activatedAt = new Date('2026-08-20T13:00:00.000Z');

    expect(service.resolvePeriod(1, activatedAt, null)).toEqual({
      periodStart: activatedAt,
      periodEnd: new Date('2026-09-20T13:00:00.000Z'),
    });
  });

  it('appends renewal months to a future paid-through boundary', () => {
    const activatedAt = new Date('2026-08-20T13:00:00.000Z');
    const paidThrough = new Date('2026-11-20T13:00:00.000Z');

    expect(service.resolvePeriod(2, activatedAt, paidThrough)).toEqual({
      periodStart: paidThrough,
      periodEnd: new Date('2027-01-20T13:00:00.000Z'),
    });
  });

  it('starts restoration from successful activation when prior paid-through is in the past', () => {
    const activatedAt = new Date('2026-08-20T13:00:00.000Z');
    const paidThrough = new Date('2026-07-20T13:00:00.000Z');

    expect(service.resolvePeriod(1, activatedAt, paidThrough)).toEqual({
      periodStart: activatedAt,
      periodEnd: new Date('2026-09-20T13:00:00.000Z'),
    });
  });

  it('clamps end-of-month anniversaries deterministically', () => {
    expect(service.addCalendarMonths(new Date('2027-01-31T10:15:00.000Z'), 1)).toEqual(
      new Date('2027-02-28T10:15:00.000Z'),
    );
    expect(service.addCalendarMonths(new Date('2028-01-31T10:15:00.000Z'), 1)).toEqual(
      new Date('2028-02-29T10:15:00.000Z'),
    );
    expect(service.addCalendarMonths(new Date('2027-01-31T10:15:00.000Z'), 2)).toEqual(
      new Date('2027-03-31T10:15:00.000Z'),
    );
  });

  it('rejects non-positive month counts', () => {
    expect(() => service.resolvePeriod(0, new Date(), null)).toThrow(
      BadRequestException,
    );
  });
});
