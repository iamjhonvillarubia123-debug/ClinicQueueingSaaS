import { BadRequestException, Injectable } from '@nestjs/common';

export type SubscriptionPurchaseQuote = {
  monthsPurchased: number;
  monthlyPriceSnapshot: string;
  grossAmount: string;
  creditAmountApplied: string;
  externalAmountRequired: string;
};

@Injectable()
export class SubscriptionPurchaseQuoteService {
  quote(
    monthsPurchased: number,
    monthlyPrice: string,
    availableCredit: string,
  ): SubscriptionPurchaseQuote {
    if (!Number.isInteger(monthsPurchased) || monthsPurchased < 1) {
      throw new BadRequestException('monthsPurchased must be at least 1.');
    }

    const monthlyPriceCents = this.parseMoney(monthlyPrice, 'monthlyPrice');
    const availableCreditCents = this.parseMoney(
      availableCredit,
      'availableCredit',
      true,
    );
    if (monthlyPriceCents <= 0n) {
      throw new BadRequestException('monthlyPrice must be greater than zero.');
    }

    const grossAmountCents = monthlyPriceCents * BigInt(monthsPurchased);
    const creditAmountAppliedCents =
      availableCreditCents < grossAmountCents
        ? availableCreditCents
        : grossAmountCents;
    const externalAmountRequiredCents =
      grossAmountCents - creditAmountAppliedCents;

    return {
      monthsPurchased,
      monthlyPriceSnapshot: this.formatMoney(monthlyPriceCents),
      grossAmount: this.formatMoney(grossAmountCents),
      creditAmountApplied: this.formatMoney(creditAmountAppliedCents),
      externalAmountRequired: this.formatMoney(externalAmountRequiredCents),
    };
  }

  private parseMoney(value: string, field: string, allowZero = false): bigint {
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) {
      throw new BadRequestException(
        `${field} must be a non-negative amount with at most two decimal places.`,
      );
    }

    const whole = BigInt(match[1]);
    const fraction = (match[2] ?? '').padEnd(2, '0');
    const cents = whole * 100n + BigInt(fraction || '0');
    if (!allowZero && cents === 0n) {
      throw new BadRequestException(`${field} must be greater than zero.`);
    }
    return cents;
  }

  private formatMoney(cents: bigint): string {
    const whole = cents / 100n;
    const fraction = (cents % 100n).toString().padStart(2, '0');
    return `${whole}.${fraction}`;
  }
}
