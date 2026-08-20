import { Module } from '@nestjs/common';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { StandardSubscriptionPriceService } from './standard-subscription-price.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';
import { SubscriptionPurchaseService } from './subscription-purchase.service';

@Module({
  providers: [
    FinancialAccountLockService,
    StandardSubscriptionPriceService,
    SubscriptionCreditBalanceService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseService,
  ],
  exports: [
    FinancialAccountLockService,
    StandardSubscriptionPriceService,
    SubscriptionCreditBalanceService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseService,
  ],
})
export class FinancialModule {}
