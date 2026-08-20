import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { Prisma, SubscriptionCreditEntryType } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

type CreditEntryRow = {
  entryType: SubscriptionCreditEntryType;
  amount: Prisma.Decimal;
};

export type SubscriptionCreditBalance = {
  available: string;
  reserved: string;
  consumed: string;
};

@Injectable()
export class SubscriptionCreditBalanceService {
  async derive(
    transaction: TransactionClient,
    doctorFinancialAccountId: string,
  ): Promise<SubscriptionCreditBalance> {
    const entries = await transaction.subscriptionCreditEntry.findMany({
      where: { doctorFinancialAccountId },
      select: { entryType: true, amount: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

    let availableCents = 0n;
    let reservedCents = 0n;
    let consumedCents = 0n;

    for (const entry of entries as CreditEntryRow[]) {
      const amountCents = this.decimalToCents(entry.amount);

      switch (entry.entryType) {
        case SubscriptionCreditEntryType.CREDIT_CREATED:
        case SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN:
          availableCents += amountCents;
          break;

        case SubscriptionCreditEntryType.PURCHASE_RESERVED:
        case SubscriptionCreditEntryType.REFUND_RESERVED:
          availableCents -= amountCents;
          reservedCents += amountCents;
          break;

        case SubscriptionCreditEntryType.PURCHASE_CONSUMED:
          reservedCents -= amountCents;
          consumedCents += amountCents;
          break;

        case SubscriptionCreditEntryType.PURCHASE_RELEASED:
        case SubscriptionCreditEntryType.REFUND_FAILED_RELEASED:
          reservedCents -= amountCents;
          availableCents += amountCents;
          break;

        case SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT:
          availableCents -= amountCents;
          consumedCents += amountCents;
          break;

        case SubscriptionCreditEntryType.ADJUSTMENT:
          throw new InternalServerErrorException(
            'Subscription credit ADJUSTMENT direction is not defined by the approved financial model.',
          );
      }

      if (availableCents < 0n || reservedCents < 0n) {
        throw new InternalServerErrorException(
          'Subscription credit ledger is internally inconsistent.',
        );
      }
    }

    return {
      available: this.formatMoney(availableCents),
      reserved: this.formatMoney(reservedCents),
      consumed: this.formatMoney(consumedCents),
    };
  }

  private decimalToCents(value: Prisma.Decimal): bigint {
    const normalized = value.toFixed(2);
    const match = /^(\d+)\.(\d{2})$/.exec(normalized);
    if (!match) {
      throw new InternalServerErrorException(
        'Subscription credit ledger contains an invalid monetary amount.',
      );
    }
    return BigInt(match[1]) * 100n + BigInt(match[2]);
  }

  private formatMoney(cents: bigint): string {
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  }
}
