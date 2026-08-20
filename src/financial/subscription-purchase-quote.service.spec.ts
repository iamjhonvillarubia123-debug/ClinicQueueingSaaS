import { BadRequestException } from '@nestjs/common';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';

describe('SubscriptionPurchaseQuoteService', () => {
  const service = new SubscriptionPurchaseQuoteService();

  it('applies available credit before external payment', () => {
    expect(service.quote(3, '1200.00', '500.25')).toEqual({
      monthsPurchased: 3,
      monthlyPriceSnapshot: '1200.00',
      grossAmount: '3600.00',
      creditAmountApplied: '500.25',
      externalAmountRequired: '3099.75',
    });
  });

  it('uses no external payment when credit fully covers the purchase', () => {
    expect(service.quote(2, '1000', '2500')).toEqual({
      monthsPurchased: 2,
      monthlyPriceSnapshot: '1000.00',
      grossAmount: '2000.00',
      creditAmountApplied: '2000.00',
      externalAmountRequired: '0.00',
    });
  });

  it('uses exact cent arithmetic rather than floating point', () => {
    expect(service.quote(3, '0.10', '0.20')).toEqual({
      monthsPurchased: 3,
      monthlyPriceSnapshot: '0.10',
      grossAmount: '0.30',
      creditAmountApplied: '0.20',
      externalAmountRequired: '0.10',
    });
  });

  it('rejects more than two decimal places', () => {
    expect(() => service.quote(1, '100.001', '0')).toThrow(
      BadRequestException,
    );
  });

  it('rejects negative or invalid available credit', () => {
    expect(() => service.quote(1, '100.00', '-1.00')).toThrow(
      BadRequestException,
    );
    expect(() => service.quote(1, '100.00', 'NaN')).toThrow(
      BadRequestException,
    );
  });
});
