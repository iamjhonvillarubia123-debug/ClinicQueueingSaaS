import { Module } from '@nestjs/common';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';

@Module({
  providers: [
    FinancialAccountLockService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseQuoteService,
  ],
  exports: [
    FinancialAccountLockService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseQuoteService,
  ],
})
export class FinancialModule {}
