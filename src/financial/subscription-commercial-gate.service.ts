import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SubscriptionEntitlementEvaluation,
  SubscriptionEntitlementService,
} from './subscription-entitlement.service';

export type SubscriptionCommercialAuthority = {
  doctorUserId: string;
  doctorFinancialAccountId: string;
  entitlement: SubscriptionEntitlementEvaluation;
};

@Injectable()
export class SubscriptionCommercialGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlement: SubscriptionEntitlementService,
  ) {}

  async assertAllowsNewActivity(
    doctorUserId: string,
    now = new Date(),
  ): Promise<SubscriptionCommercialAuthority> {
    const normalizedDoctorUserId = doctorUserId.trim();
    if (!normalizedDoctorUserId) {
      throw new ForbiddenException(
        'Subscription entitlement does not allow new activity.',
      );
    }

    const financialAccount =
      await this.prisma.doctorFinancialAccount.findUnique({
        where: { doctorUserId: normalizedDoctorUserId },
        select: { id: true },
      });
    if (!financialAccount) {
      throw new ForbiddenException(
        'Subscription entitlement does not allow new activity.',
      );
    }

    const entitlement = await this.entitlement.evaluateForFinancialAccount(
      financialAccount.id,
      now,
    );
    if (!entitlement.allowsNewSubscriptionGatedActivity) {
      throw new ForbiddenException(
        'Subscription entitlement does not allow new activity.',
      );
    }

    return {
      doctorUserId: normalizedDoctorUserId,
      doctorFinancialAccountId: financialAccount.id,
      entitlement,
    };
  }
}
