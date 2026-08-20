import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { StandardSubscriptionPriceService } from './standard-subscription-price.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseCompletionService } from './subscription-purchase-completion.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';
import { SubscriptionPurchaseResolutionService } from './subscription-purchase-resolution.service';
import { SubscriptionPurchaseService } from './subscription-purchase.service';

@Module({
  imports: [AuthModule, IdempotencyModule, NotificationModule],
  providers: [
    FinancialAccountLockService,
    StandardSubscriptionPriceService,
    SubscriptionCreditBalanceService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseCompletionService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseResolutionService,
    SubscriptionPurchaseService,
  ],
  exports: [
    FinancialAccountLockService,
    StandardSubscriptionPriceService,
    SubscriptionCreditBalanceService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseCompletionService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseResolutionService,
    SubscriptionPurchaseService,
  ],
})
export class FinancialModule {}
