import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
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

type LockedCommercialEntitlement = {
  doctorFinancialAccountId: string;
  paidThrough: Date;
  graceEndsAt: Date;
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
    const normalizedDoctorUserId = this.normalizeDoctorUserId(doctorUserId);
    const financialAccount =
      await this.prisma.doctorFinancialAccount.findUnique({
        where: { doctorUserId: normalizedDoctorUserId },
        select: { id: true },
      });
    if (!financialAccount) {
      this.deny();
    }

    const entitlement = await this.entitlement.evaluateForFinancialAccount(
      financialAccount.id,
      now,
    );
    this.assertEvaluationAllowsNewActivity(entitlement);

    return {
      doctorUserId: normalizedDoctorUserId,
      doctorFinancialAccountId: financialAccount.id,
      entitlement,
    };
  }

  async assertAllowsNewActivityInTransaction(
    transaction: Prisma.TransactionClient,
    doctorUserId: string,
    now = new Date(),
  ): Promise<SubscriptionCommercialAuthority> {
    const normalizedDoctorUserId = this.normalizeDoctorUserId(doctorUserId);
    const rows = await transaction.$queryRaw<LockedCommercialEntitlement[]>(
      Prisma.sql`
        SELECT
          dfa."id" AS "doctorFinancialAccountId",
          dse."paidThrough",
          dse."graceEndsAt"
        FROM "DoctorFinancialAccount" dfa
        INNER JOIN "DoctorSubscriptionEntitlement" dse
          ON dse."doctorFinancialAccountId" = dfa."id"
        WHERE dfa."doctorUserId" = ${normalizedDoctorUserId}
        LIMIT 1
        FOR UPDATE OF dfa, dse
      `,
    );
    const locked = rows[0];
    if (!locked) {
      this.deny();
    }

    const state = this.entitlement.evaluateDates(
      locked.paidThrough,
      locked.graceEndsAt,
      now,
    );
    const evaluation: SubscriptionEntitlementEvaluation = {
      hasEntitlementRecord: true,
      state,
      paidThrough: locked.paidThrough,
      graceEndsAt: locked.graceEndsAt,
      allowsNewSubscriptionGatedActivity: state !== 'SUSPENDED',
    };
    this.assertEvaluationAllowsNewActivity(evaluation);

    return {
      doctorUserId: normalizedDoctorUserId,
      doctorFinancialAccountId: locked.doctorFinancialAccountId,
      entitlement: evaluation,
    };
  }

  private normalizeDoctorUserId(doctorUserId: string): string {
    const normalizedDoctorUserId = doctorUserId.trim();
    if (!normalizedDoctorUserId) {
      this.deny();
    }
    return normalizedDoctorUserId;
  }

  private assertEvaluationAllowsNewActivity(
    evaluation: SubscriptionEntitlementEvaluation,
  ): void {
    if (!evaluation.allowsNewSubscriptionGatedActivity) {
      this.deny();
    }
  }

  private deny(): never {
    throw new ForbiddenException(
      'Subscription entitlement does not allow new activity.',
    );
  }
}
