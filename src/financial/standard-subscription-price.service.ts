import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StandardSubscriptionPriceService {
  constructor(private readonly config: ConfigService) {}

  getMonthlyPrice(): string {
    const raw = this.config.get<string>('SUBSCRIPTION_MONTHLY_PRICE')?.trim();
    const match = raw ? /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw) : null;
    if (!match) {
      throw new InternalServerErrorException(
        'SUBSCRIPTION_MONTHLY_PRICE configuration is missing or invalid.',
      );
    }

    const whole = BigInt(match[1]);
    const fraction = (match[2] ?? '').padEnd(2, '0');
    const cents = whole * 100n + BigInt(fraction || '0');
    if (cents <= 0n) {
      throw new InternalServerErrorException(
        'SUBSCRIPTION_MONTHLY_PRICE must be greater than zero.',
      );
    }

    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  }
}
