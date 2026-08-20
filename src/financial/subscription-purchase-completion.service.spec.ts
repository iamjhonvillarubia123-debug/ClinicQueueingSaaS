import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseCompletionService } from './subscription-purchase-completion.service';

describe('SubscriptionPurchaseCompletionService', () => {
  const completedAt = new Date('2026-08-20T14:00:00.000Z');

  function createFixture(options: { suspended?: boolean } = {}) {
    const purchase = {
      id: 'purchase-1',
      doctorFinancialAccountId: 'financial-1',
      purchasedByUserId: 'doctor-1',
      monthsPurchased: 1,
      monthlyPriceSnapshot: new Prisma.Decimal('100.00'),
      grossAmount: new Prisma.Decimal('100.00'),
      creditAmountApplied: new Prisma.Decimal('40.00'),
      externalAmountRequired: new Prisma.Decimal('60.00'),
      periodStart: new Date('2026-08-20T13:00:00.000Z'),
      periodEnd: new Date('2026-09-20T13:00:00.000Z'),
      status: SubscriptionPurchaseStatus.PENDING,
      commandIdempotencyId: 'command-1',
      createdAt: new Date('2026-08-20T13:00:00.000Z'),
      completedAt: null,
    };
    const entitlement = options.suspended
      ? {
          id: 'entitlement-1',
          doctorFinancialAccountId: 'financial-1',
          paidThrough: new Date('2026-08-01T00:00:00.000Z'),
          graceEndsAt: new Date('2026-08-08T00:00:00.000Z'),
        }
      : null;
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: 'purchase-1' }])),
      subscriptionPurchase: {
        findUnique: jest.fn(() => Promise.resolve(purchase)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...purchase, ...data }),
        ),
      },
      subscriptionPayment: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'payment-1', ...data }),
        ),
      },
      doctorSubscriptionEntitlement: {
        findUnique: jest.fn(() => Promise.resolve(entitlement)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...entitlement, ...data }),
        ),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'entitlement-1', ...data }),
        ),
      },
      subscriptionCreditEntry: {
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { entryType: SubscriptionCreditEntryType };
          }) =>
            Promise.resolve(
              where.entryType ===
                SubscriptionCreditEntryType.PURCHASE_CONSUMED
                ? null
                : {
                    id: 'reservation-1',
                    amount: new Prisma.Decimal('40.00'),
                    commandIdempotencyId: 'command-1',
                  },
            ),
        ),
        create: jest.fn(() => Promise.resolve({ id: 'consumed-1' })),
      },
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({ email: 'doctor@example.com' }),
        ),
      },
      notificationOutbox: {
        create: jest.fn(() => Promise.resolve({ id: 'outbox-1' })),
      },
      subscriptionEntitlementEvent: {
        create: jest.fn(() =>
          Promise.resolve({ id: 'event-1', eventType: 'RESTORED' }),
        ),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const accountLocks = {
      lockById: jest.fn(() =>
        Promise.resolve({ id: 'financial-1', doctorUserId: 'doctor-1' }),
      ),
    };
    const protectedPayload = {
      encrypt: jest.fn(() => 'encrypted-email'),
    };
    const notificationPayload = {
      encryptMessage: jest.fn(() => 'encrypted-message'),
    };
    const service = new SubscriptionPurchaseCompletionService(
      prisma as never,
      accountLocks as never,
      new SubscriptionEntitlementService({} as never),
      new SubscriptionPeriodService(),
      protectedPayload as never,
      notificationPayload as never,
    );
    return { service, transaction, purchase };
  }

  it('completes a provider-funded purchase exactly once and consumes reserved credit', async () => {
    const { service, transaction } = createFixture();

    await expect(
      service.confirmExternalPayment({
        purchaseId: 'purchase-1',
        provider: 'test-provider',
        providerPaymentReference: 'payment-ref-1',
        amount: '60.00',
        confirmedAt: completedAt,
      }),
    ).resolves.toMatchObject({ paymentReplayed: false, replayed: false });

    expect(transaction.subscriptionPayment.create).toHaveBeenCalledTimes(1);
    expect(transaction.subscriptionCreditEntry.create).toHaveBeenCalledTimes(1);
    expect(transaction.subscriptionPurchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionPurchaseStatus.COMPLETED,
          completedAt,
        }) as object,
      }),
    );
    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(1);
  });

  it('creates a restoration event and distinct outbox when suspended entitlement is restored', async () => {
    const { service, transaction } = createFixture({ suspended: true });

    await service.confirmExternalPayment({
      purchaseId: 'purchase-1',
      provider: 'test-provider',
      providerPaymentReference: 'payment-ref-1',
      amount: '60.00',
      confirmedAt: completedAt,
    });

    expect(
      transaction.subscriptionEntitlementEvent.create,
    ).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(2);
  });

  it('rejects provider payment whose amount differs from remaining balance', async () => {
    const { service, transaction } = createFixture();

    await expect(
      service.confirmExternalPayment({
        purchaseId: 'purchase-1',
        provider: 'test-provider',
        providerPaymentReference: 'payment-ref-1',
        amount: '59.99',
        confirmedAt: completedAt,
      }),
    ).rejects.toThrow();
    expect(transaction.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it('requires zero external balance for credit-only completion', async () => {
    const { service, transaction, purchase } = createFixture();
    purchase.externalAmountRequired = new Prisma.Decimal('0.00');

    await expect(
      service.completeCreditOnly('purchase-1', completedAt),
    ).resolves.toMatchObject({ replayed: false });
    expect(transaction.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it('stores provider success evidence as SUCCEEDED', async () => {
    const { service, transaction } = createFixture();

    await service.confirmExternalPayment({
      purchaseId: 'purchase-1',
      provider: 'test-provider',
      providerPaymentReference: 'payment-ref-1',
      amount: '60.00',
      confirmedAt: completedAt,
    });

    expect(transaction.subscriptionPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionPaymentStatus.SUCCEEDED,
        }) as object,
      }),
    );
  });
});
