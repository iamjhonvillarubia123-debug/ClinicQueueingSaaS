import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { DoctorClosureFinancialSettlementService } from './doctor-closure-financial-settlement.service';
import { FinancialAccessChallengeService } from './financial-access-challenge.service';
import { FinancialAccessSessionService } from './financial-access-session.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { RefundNotificationService } from './refund-notification.service';
import { RefundProcessingService } from './refund-processing.service';
import { RefundRequestService } from './refund-request.service';
import { StandardSubscriptionPriceService } from './standard-subscription-price.service';
import { SubscriptionCommercialGateService } from './subscription-commercial-gate.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';
import { SubscriptionCreditRecoveryService } from './subscription-credit-recovery.service';
import { SubscriptionEntitlementTransitionService } from './subscription-entitlement-transition.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseCompletionService } from './subscription-purchase-completion.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';
import { SubscriptionPurchaseResolutionService } from './subscription-purchase-resolution.service';
import { SubscriptionPurchaseService } from './subscription-purchase.service';

@Module({
  imports: [AuthModule, IdempotencyModule, NotificationModule],
  providers: [
    DoctorClosureFinancialSettlementService,
    FinancialAccessChallengeService,
    FinancialAccessSessionService,
    FinancialAccountLockService,
    RefundNotificationService,
    RefundProcessingService,
    RefundRequestService,
    StandardSubscriptionPriceService,
    SubscriptionCommercialGateService,
    SubscriptionCreditBalanceService,
    SubscriptionCreditRecoveryService,
    SubscriptionEntitlementTransitionService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseCompletionService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseResolutionService,
    SubscriptionPurchaseService,
  ],
  exports: [
    DoctorClosureFinancialSettlementService,
    FinancialAccessChallengeService,
    FinancialAccessSessionService,
    FinancialAccountLockService,
    RefundNotificationService,
    RefundProcessingService,
    RefundRequestService,
    StandardSubscriptionPriceService,
    SubscriptionCommercialGateService,
    SubscriptionCreditBalanceService,
    SubscriptionCreditRecoveryService,
    SubscriptionEntitlementTransitionService,
    SubscriptionEntitlementService,
    SubscriptionPeriodService,
    SubscriptionPurchaseCompletionService,
    SubscriptionPurchaseQuoteService,
    SubscriptionPurchaseResolutionService,
    SubscriptionPurchaseService,
  ],
})
export class FinancialModule {}
