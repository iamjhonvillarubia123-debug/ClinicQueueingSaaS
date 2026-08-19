import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DURATION_MS = 7 * DAY_MS;

export type SubscriptionEntitlementState = 'PAID' | 'GRACE' | 'SUSPENDED';

export type SubscriptionEntitlementEvaluation = {
  hasEntitlementRecord: boolean;
  state: SubscriptionEntitlementState | null;
  paidThrough: Date | null;
  graceEndsAt: Date | null;
  allowsNewSubscriptionGatedActivity: boolean;
};

@Injectable()
export class SubscriptionEntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateForFinancialAccount(
    doctorFinancialAccountId: string,
    now = new Date(),
  ): Promise<SubscriptionEntitlementEvaluation> {
    const entitlement = await this.prisma.doctorSubscriptionEntitlement.findUnique({
      where: { doctorFinancialAccountId },
      select: { paidThrough: true, graceEndsAt: true },
    });

    if (!entitlement) {
      return {
        hasEntitlementRecord: false,
        state: null,
        paidThrough: null,
        graceEndsAt: null,
        allowsNewSubscriptionGatedActivity: false,
      };
    }

    const state = this.evaluateDates(
      entitlement.paidThrough,
      entitlement.graceEndsAt,
      now,
    );

    return {
      hasEntitlementRecord: true,
      state,
      paidThrough: entitlement.paidThrough,
      graceEndsAt: entitlement.graceEndsAt,
      allowsNewSubscriptionGatedActivity: state !== 'SUSPENDED',
    };
  }

  evaluateDates(
    paidThrough: Date,
    graceEndsAt: Date,
    now = new Date(),
  ): SubscriptionEntitlementState {
    if (
      Number.isNaN(paidThrough.getTime()) ||
      Number.isNaN(graceEndsAt.getTime()) ||
      graceEndsAt.getTime() - paidThrough.getTime() !== GRACE_DURATION_MS
    ) {
      throw new InternalServerErrorException(
        'Subscription entitlement dates are inconsistent.',
      );
    }

    if (now.getTime() < paidThrough.getTime()) return 'PAID';
    if (now.getTime() < graceEndsAt.getTime()) return 'GRACE';
    return 'SUSPENDED';
  }
}
