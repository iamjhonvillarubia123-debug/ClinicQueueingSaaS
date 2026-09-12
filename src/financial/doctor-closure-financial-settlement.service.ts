import { createHash } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { SubscriptionPeriodService } from './subscription-period.service';

const RECOVERY_EMAIL_PURPOSE = 'doctor-financial-account:recovery-email';
const RECOVERY_IDENTIFIER_PURPOSE =
  'doctor-financial-account:recovery-identifier';

type TransactionClient = Prisma.TransactionClient;

type LockedFinancialAccount = {
  id: string;
  doctorUserId: string;
};

export type DoctorClosureFinancialPreparation = {
  doctorFinancialAccountId: string | null;
};

export type DoctorClosureFinancialSettlement = {
  doctorFinancialAccountId: string | null;
  creditCreated: string;
  creditedFuturePeriods: number;
};

export type FinancialRecoveryIdentity = {
  type: 'EMAIL' | 'MOBILE';
  value: string;
};

@Injectable()
export class DoctorClosureFinancialSettlementService {
  constructor(
    private readonly protectedPayload: ProtectedAccountPayloadService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly periods: SubscriptionPeriodService,
  ) {}

  async prepare(
    transaction: TransactionClient,
    doctorUserId: string,
  ): Promise<DoctorClosureFinancialPreparation> {
    const rows = await transaction.$queryRaw<LockedFinancialAccount[]>(
      Prisma.sql`
        SELECT "id", "doctorUserId"
        FROM "DoctorFinancialAccount"
        WHERE "doctorUserId" = ${doctorUserId}
        FOR UPDATE
      `,
    );
    const financialAccount = rows[0] ?? null;
    if (!financialAccount) {
      return { doctorFinancialAccountId: null };
    }

    const pendingPurchase = await transaction.subscriptionPurchase.findFirst({
      where: {
        doctorFinancialAccountId: financialAccount.id,
        status: SubscriptionPurchaseStatus.PENDING,
      },
      select: { id: true },
    });
    if (pendingPurchase) {
      throw new ConflictException(
        'Permanent closure is unavailable while a subscription purchase is still pending.',
      );
    }

    const pendingPayment = await transaction.subscriptionPayment.findFirst({
      where: {
        status: SubscriptionPaymentStatus.PENDING,
        subscriptionPurchase: {
          doctorFinancialAccountId: financialAccount.id,
        },
      },
      select: { id: true },
    });
    if (pendingPayment) {
      throw new ConflictException(
        'Permanent closure is unavailable while a subscription payment is still pending.',
      );
    }

    return { doctorFinancialAccountId: financialAccount.id };
  }

  async settle(
    transaction: TransactionClient,
    input: {
      doctorFinancialAccountId: string | null;
      recoveryIdentity: FinancialRecoveryIdentity;
      closureCommandId: string;
      closedAt: Date;
    },
  ): Promise<DoctorClosureFinancialSettlement> {
    if (!input.doctorFinancialAccountId) {
      return {
        doctorFinancialAccountId: null,
        creditCreated: '0.00',
        creditedFuturePeriods: 0,
      };
    }

    const recoveryIdentity = this.normalizeRecoveryIdentity(
      input.recoveryIdentity,
    );
    const recoveryIdentifierEncrypted = this.protectedPayload.encrypt(
      recoveryIdentity.value,
      `${RECOVERY_IDENTIFIER_PURPOSE}:${recoveryIdentity.type.toLowerCase()}`,
    );
    const recoveryIdentifierHash =
      recoveryIdentity.type === 'EMAIL'
        ? this.sha256(recoveryIdentity.value)
        : this.mobileNumberService.hashCanonical(recoveryIdentity.value);

    await transaction.$executeRaw(
      Prisma.sql`
        UPDATE "DoctorFinancialAccount"
        SET
          "recoveryIdentifierType" = CAST(${recoveryIdentity.type} AS "AccountLoginIdentifierType"),
          "recoveryIdentifierEncrypted" = ${recoveryIdentifierEncrypted},
          "recoveryIdentifierHash" = ${recoveryIdentifierHash},
          "recoveryEmailEncrypted" = ${
            recoveryIdentity.type === 'EMAIL'
              ? this.protectedPayload.encrypt(
                  recoveryIdentity.value,
                  RECOVERY_EMAIL_PURPOSE,
                )
              : null
          },
          "recoveryEmailHash" = ${
            recoveryIdentity.type === 'EMAIL'
              ? this.sha256(recoveryIdentity.value)
              : null
          }
        WHERE "id" = ${input.doctorFinancialAccountId}
      `,
    );

    const purchases = await transaction.subscriptionPurchase.findMany({
      where: {
        doctorFinancialAccountId: input.doctorFinancialAccountId,
        status: SubscriptionPurchaseStatus.COMPLETED,
      },
      select: {
        id: true,
        monthsPurchased: true,
        monthlyPriceSnapshot: true,
        periodStart: true,
      },
      orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
    });

    let creditCreated = new Prisma.Decimal(0);
    let creditedFuturePeriods = 0;

    for (const purchase of purchases) {
      const unusedFuturePeriods = this.countFullyUnusedFuturePeriods(
        purchase.periodStart,
        purchase.monthsPurchased,
        input.closedAt,
      );
      if (unusedFuturePeriods === 0) continue;

      creditCreated = creditCreated.add(
        purchase.monthlyPriceSnapshot.mul(unusedFuturePeriods),
      );
      creditedFuturePeriods += unusedFuturePeriods;
    }

    if (creditCreated.greaterThan(0)) {
      await transaction.subscriptionCreditEntry.create({
        data: {
          doctorFinancialAccountId: input.doctorFinancialAccountId,
          entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
          amount: creditCreated,
          commandIdempotencyId: input.closureCommandId,
          occurredAt: input.closedAt,
        },
      });
    }

    return {
      doctorFinancialAccountId: input.doctorFinancialAccountId,
      creditCreated: creditCreated.toFixed(2),
      creditedFuturePeriods,
    };
  }

  private normalizeRecoveryIdentity(
    identity: FinancialRecoveryIdentity,
  ): FinancialRecoveryIdentity {
    if (identity.type === 'EMAIL') {
      return { type: 'EMAIL', value: identity.value.trim().toLowerCase() };
    }
    return {
      type: 'MOBILE',
      value: this.mobileNumberService.normalize(identity.value).canonical,
    };
  }

  private countFullyUnusedFuturePeriods(
    periodStart: Date,
    monthsPurchased: number,
    closedAt: Date,
  ): number {
    let count = 0;
    for (let monthIndex = 0; monthIndex < monthsPurchased; monthIndex += 1) {
      const monthlyPeriodStart =
        monthIndex === 0
          ? periodStart
          : this.periods.addCalendarMonths(periodStart, monthIndex);
      if (monthlyPeriodStart.getTime() > closedAt.getTime()) count += 1;
    }
    return count;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
