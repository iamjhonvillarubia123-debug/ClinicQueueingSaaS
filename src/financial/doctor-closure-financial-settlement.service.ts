import { createHash } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { SubscriptionPeriodService } from './subscription-period.service';

const RECOVERY_EMAIL_PURPOSE = 'doctor-financial-account:recovery-email';

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

@Injectable()
export class DoctorClosureFinancialSettlementService {
  constructor(
    private readonly protectedPayload: ProtectedAccountPayloadService,
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
      recoveryEmail: string;
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

    const recoveryEmail = input.recoveryEmail.trim().toLowerCase();
    await transaction.doctorFinancialAccount.update({
      where: { id: input.doctorFinancialAccountId },
      data: {
        recoveryEmailEncrypted: this.protectedPayload.encrypt(
          recoveryEmail,
          RECOVERY_EMAIL_PURPOSE,
        ),
        recoveryEmailHash: this.sha256(recoveryEmail),
      },
    });

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

      const amount = purchase.monthlyPriceSnapshot.mul(unusedFuturePeriods);
      await transaction.subscriptionCreditEntry.create({
        data: {
          doctorFinancialAccountId: input.doctorFinancialAccountId,
          entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
          amount,
          subscriptionPurchaseId: purchase.id,
          commandIdempotencyId: input.closureCommandId,
          occurredAt: input.closedAt,
        },
      });
      creditCreated = creditCreated.add(amount);
      creditedFuturePeriods += unusedFuturePeriods;
    }

    return {
      doctorFinancialAccountId: input.doctorFinancialAccountId,
      creditCreated: creditCreated.toFixed(2),
      creditedFuturePeriods,
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
