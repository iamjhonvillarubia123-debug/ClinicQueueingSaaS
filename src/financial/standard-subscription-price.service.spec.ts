import { InternalServerErrorException } from '@nestjs/common';
import { StandardSubscriptionPriceService } from './standard-subscription-price.service';

describe('StandardSubscriptionPriceService', () => {
  function serviceFor(value: string | undefined) {
    const config = {
      get: jest.fn(() => value),
    };
    return new StandardSubscriptionPriceService(config as never);
  }

  it('normalizes the configured standard monthly price to two decimals', () => {
    expect(serviceFor('1200').getMonthlyPrice()).toBe('1200.00');
    expect(serviceFor('1200.5').getMonthlyPrice()).toBe('1200.50');
  });

  it('rejects missing, zero, negative, or over-precision configuration', () => {
    for (const value of [undefined, '0', '-1.00', '100.001', 'abc']) {
      expect(() => serviceFor(value).getMonthlyPrice()).toThrow(
        InternalServerErrorException,
      );
    }
  });
});
