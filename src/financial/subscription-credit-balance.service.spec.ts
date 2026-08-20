import { InternalServerErrorException } from '@nestjs/common';
import { Prisma, SubscriptionCreditEntryType } from '../../generated/prisma/client';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';

describe('SubscriptionCreditBalanceService', () => {
  const service = new SubscriptionCreditBalanceService();

  function transactionFor(
    entries: Array<{
      entryType: SubscriptionCreditEntryType;
      amount: string;
    }>,
  ) {
    return {
      subscriptionCreditEntry: {
        findMany: jest.fn(() =>
          Promise.resolve(
            entries.map((entry) => ({
              entryType: entry.entryType,
              amount: new Prisma.Decimal(entry.amount),
            })),
          ),
        ),
      },
    };
  }

  it('derives available, reserved and consumed credit from committed movements', async () => {
    const transaction = transactionFor([
      {
        entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
        amount: '1000.00',
      },
      {
        entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
        amount: '250.00',
      },
      {
        entryType: SubscriptionCreditEntryType.PURCHASE_CONSUMED,
        amount: '250.00',
      },
      {
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
        amount: '100.50',
      },
      {
        entryType: SubscriptionCreditEntryType.REFUND_RESERVED,
        amount: '50.25',
      },
      {
        entryType: SubscriptionCreditEntryType.REFUND_FAILED_RELEASED,
        amount: '50.25',
      },
      {
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
        amount: '10.00',
      },
    ]);

    await expect(service.derive(transaction as never, 'account-1')).resolves.toEqual({
      available: '840.50',
      reserved: '0.00',
      consumed: '260.00',
    });
  });

  it('restores purchase reservation to available credit when released', async () => {
    const transaction = transactionFor([
      {
        entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
        amount: '500.00',
      },
      {
        entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
        amount: '125.00',
      },
      {
        entryType: SubscriptionCreditEntryType.PURCHASE_RELEASED,
        amount: '125.00',
      },
    ]);

    await expect(service.derive(transaction as never, 'account-1')).resolves.toEqual({
      available: '500.00',
      reserved: '0.00',
      consumed: '0.00',
    });
  });

  it('fails closed when ledger movements would make available credit negative', async () => {
    const transaction = transactionFor([
      {
        entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
        amount: '1.00',
      },
    ]);

    await expect(
      service.derive(transaction as never, 'account-1'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('fails closed for ADJUSTMENT because its direction is not defined', async () => {
    const transaction = transactionFor([
      {
        entryType: SubscriptionCreditEntryType.ADJUSTMENT,
        amount: '1.00',
      },
    ]);

    await expect(
      service.derive(transaction as never, 'account-1'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
