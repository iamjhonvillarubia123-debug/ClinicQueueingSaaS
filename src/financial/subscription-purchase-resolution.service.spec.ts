import { InternalServerErrorException } from '@nestjs/common';
import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { SubscriptionPurchaseResolutionService } from './subscription-purchase-resolution.service';

describe('SubscriptionPurchaseResolutionService', () => {
  const makeFixture = (creditAmount = '250.00') => {
    const purchase = {
      id: 'purchase-1',
      doctorFinancialAccountId: 'financial-1',
      creditAmountApplied: new Prisma.Decimal(creditAmount),
      status: SubscriptionPurchaseStatus.PENDING,
    };
    const reservation = {
      id: 'reservation-1',
      amount: new Prisma.Decimal(creditAmount),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([purchase]),
      subscriptionPayment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionCreditEntry: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(reservation)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue({ id: 'release-1' }),
      },
      subscriptionPurchase: {
        update: jest.fn().mockImplementation(({ data }: { data: { status: SubscriptionPurchaseStatus } }) =>
          Promise.resolve({ ...purchase, status: data.status }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const accountLocks = { lockById: jest.fn().mockResolvedValue(undefined) };
    const service = new SubscriptionPurchaseResolutionService(
      prisma as never,
      accountLocks as never,
    );
    return { service, transaction, accountLocks, purchase, reservation };
  };

  it('marks a pending purchase failed and releases its reserved credit', async () => {
    const fixture = makeFixture();
    const resolvedAt = new Date('2026-08-20T03:00:00.000Z');

    const result = await fixture.service.failPurchase('purchase-1', resolvedAt);

    expect(fixture.accountLocks.lockById).toHaveBeenCalledWith(
      fixture.transaction,
      'financial-1',
    );
    expect(fixture.transaction.subscriptionPayment.updateMany).toHaveBeenCalledWith({
      where: {
        subscriptionPurchaseId: 'purchase-1',
        status: SubscriptionPaymentStatus.PENDING,
      },
      data: { status: SubscriptionPaymentStatus.FAILED, failedAt: resolvedAt },
    });
    expect(fixture.transaction.subscriptionCreditEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: SubscriptionCreditEntryType.PURCHASE_RELEASED,
        amount: fixture.purchase.creditAmountApplied,
        relatedCreditEntryId: fixture.reservation.id,
      }),
    });
    expect(result.purchase.status).toBe(SubscriptionPurchaseStatus.FAILED);
    expect(result.replayed).toBe(false);
  });

  it('marks an expired purchase and expires pending payment evidence', async () => {
    const fixture = makeFixture('0.00');
    const resolvedAt = new Date('2026-08-20T03:00:00.000Z');

    const result = await fixture.service.expirePurchase('purchase-1', resolvedAt);

    expect(fixture.transaction.subscriptionPayment.updateMany).toHaveBeenCalledWith({
      where: {
        subscriptionPurchaseId: 'purchase-1',
        status: SubscriptionPaymentStatus.PENDING,
      },
      data: { status: SubscriptionPaymentStatus.EXPIRED, failedAt: resolvedAt },
    });
    expect(fixture.transaction.subscriptionCreditEntry.create).not.toHaveBeenCalled();
    expect(result.purchase.status).toBe(SubscriptionPurchaseStatus.EXPIRED);
  });

  it('refuses to fail a purchase that already has successful payment evidence', async () => {
    const fixture = makeFixture();
    fixture.transaction.subscriptionPayment.findFirst.mockResolvedValue({ id: 'payment-1' });

    await expect(fixture.service.failPurchase('purchase-1')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(fixture.transaction.subscriptionCreditEntry.create).not.toHaveBeenCalled();
    expect(fixture.transaction.subscriptionPurchase.update).not.toHaveBeenCalled();
  });

  it('does not create a second release when the reservation is already released', async () => {
    const fixture = makeFixture();
    fixture.transaction.subscriptionCreditEntry.findFirst
      .mockReset()
      .mockResolvedValueOnce(fixture.reservation)
      .mockResolvedValueOnce({
        id: 'release-1',
        entryType: SubscriptionCreditEntryType.PURCHASE_RELEASED,
      });

    const result = await fixture.service.failPurchase('purchase-1');

    expect(fixture.transaction.subscriptionCreditEntry.create).not.toHaveBeenCalled();
    expect(result.purchase.status).toBe(SubscriptionPurchaseStatus.FAILED);
  });
});
