import { Module } from '@nestjs/common';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';

@Module({
  providers: [FinancialAccountLockService, SubscriptionEntitlementService],
  exports: [FinancialAccountLockService, SubscriptionEntitlementService],
})
export class FinancialModule {}
