import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class SubscriptionPeriodService {
  resolvePeriod(
    monthsPurchased: number,
    successfulActivationAt: Date,
    existingPaidThrough: Date | null,
  ) {
    if (!Number.isInteger(monthsPurchased) || monthsPurchased < 1) {
      throw new BadRequestException('monthsPurchased must be at least 1.');
    }
    if (Number.isNaN(successfulActivationAt.getTime())) {
      throw new BadRequestException('successfulActivationAt is invalid.');
    }
    if (existingPaidThrough && Number.isNaN(existingPaidThrough.getTime())) {
      throw new BadRequestException('existingPaidThrough is invalid.');
    }

    const periodStart =
      existingPaidThrough &&
      existingPaidThrough.getTime() > successfulActivationAt.getTime()
        ? existingPaidThrough
        : successfulActivationAt;
    const periodEnd = this.addCalendarMonths(periodStart, monthsPurchased);

    return { periodStart, periodEnd };
  }

  addCalendarMonths(anchor: Date, months: number): Date {
    if (!Number.isInteger(months) || months < 1) {
      throw new BadRequestException('months must be a positive integer.');
    }
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException('anchor is invalid.');
    }

    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const day = anchor.getUTCDate();
    const targetMonthIndex = month + months;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();

    return new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(day, lastDay),
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
  }
}
