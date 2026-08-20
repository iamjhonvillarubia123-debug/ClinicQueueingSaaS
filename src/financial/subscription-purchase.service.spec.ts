import {
  AdministrativeRestrictionStatus,
  SubscriptionPurchaseStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';
import { SubscriptionPurchaseService } from './subscription-purchase.service';

describe('SubscriptionPurchaseService', () => {
  function createFixture(
    options: {
      replay?: boolean;
      availableCredit?: string;
      existingFinancialAccount?: boolean;
    } = {},
  ) {
    let purchaseCreateInput: unknown;
    let creditCreateInput: unknown;
    const purchase = {
      id: 'purchase-1',
      doctorFinancialAccountId: 'financial-1',
      purchasedByUserId: 'doctor-1',
      monthsPurchased: 2,
      monthlyPriceSnapshot: '100.00',
      grossAmount: '200.00',
      creditAmountApplied: '50.00',
      externalAmountRequired: '150.00',
      periodStart: new Date('2026-08-20T13:00:00.000Z'),
      periodEnd: new Date('2026-10-20T13:00:00.000Z'),
      status: SubscriptionPurchaseStatus.PENDING,
      commandIdempotencyId: 'command-1',
      createdAt: new Date('2026-08-20T13:00:00.000Z'),
      completedAt: null,
    };
    const transaction = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'doctor-1',
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
          }),
        ),
      },
      doctorFinancialAccount: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            options.existingFinancialAccount === false
              ? null
              : { id: 'financial-1', doctorUserId: 'doctor-1' },
          ),
        ),
        create: jest.fn(() =>
          Promise.resolve({ id: 'financial-1', doctorUserId: 'doctor-1' }),
        ),
      },
      doctorSubscriptionEntitlement: {
        findUnique: jest.fn(() => Promise.resolve(null)),
      },
      commandIdempotency: {
        create: jest.fn(() => Promise.resolve({ id: 'command-1' })),
      },
      subscriptionPurchase: {
        findUnique: jest.fn(() => Promise.resolve(purchase)),
        create: jest.fn((input: unknown) => {
          purchaseCreateInput = input;
          return Promise.resolve(purchase);
        }),
      },
      subscriptionCreditEntry: {
        create: jest.fn((input: unknown) => {
          creditCreateInput = input;
          return Promise.resolve({ id: 'credit-entry-1' });
        }),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const idempotency = {
      normalizeKey: jest.fn(() => 'idem-1'),
      fingerprint: jest.fn(() => 'fingerprint-1'),
      deriveIdentity: jest.fn(() => 'identity-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn(() =>
        Promise.resolve(options.replay ? { id: 'command-1' } : null),
      ),
      completionTimes: jest.fn((now: Date) => ({
        completedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      })),
    };
    const accountLocks = {
      lockById: jest.fn(() =>
        Promise.resolve({ id: 'financial-1', doctorUserId: 'doctor-1' }),
      ),
    };
    const creditBalance = {
      derive: jest.fn(() =>
        Promise.resolve({
          available: options.availableCredit ?? '50.00',
          reserved: '0.00',
          consumed: '0.00',
        }),
      ),
    };
    const price = { getMonthlyPrice: jest.fn(() => '100.00') };
    const service = new SubscriptionPurchaseService(
      prisma as never,
      idempotency as never,
      accountLocks as never,
      creditBalance as never,
      price as never,
      new SubscriptionPurchaseQuoteService(),
      new SubscriptionPeriodService(),
    );

    return {
      service,
      transaction,
      idempotency,
      accountLocks,
      creditBalance,
      getPurchaseCreateInput: () => purchaseCreateInput,
      getCreditCreateInput: () => creditCreateInput,
    };
  }

  it('creates one pending purchase and reserves available credit atomically', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        authenticatedUserId: 'doctor-1',
        monthsPurchased: 2,
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toMatchObject({ replayed: false });

    expect(fixture.transaction.commandIdempotency.create).toHaveBeenCalledTimes(
      1,
    );
    expect(
      fixture.transaction.subscriptionPurchase.create,
    ).toHaveBeenCalledTimes(1);
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.getPurchaseCreateInput()).toBeDefined();
    expect(fixture.getCreditCreateInput()).toBeDefined();
  });

  it('does not append a credit reservation when no credit is available', async () => {
    const fixture = createFixture({ availableCredit: '0.00' });

    await fixture.service.create({
      authenticatedUserId: 'doctor-1',
      monthsPurchased: 1,
      idempotencyKey: 'idem-1',
    });

    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('reconstructs a compatible retry without repeating financial effects', async () => {
    const fixture = createFixture({ replay: true });

    await expect(
      fixture.service.create({
        authenticatedUserId: 'doctor-1',
        monthsPurchased: 2,
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toMatchObject({ replayed: true });

    expect(fixture.accountLocks.lockById).not.toHaveBeenCalled();
    expect(fixture.creditBalance.derive).not.toHaveBeenCalled();
    expect(
      fixture.transaction.subscriptionPurchase.create,
    ).not.toHaveBeenCalled();
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('creates the Doctor financial aggregate inside the protected transaction when absent', async () => {
    const fixture = createFixture({ existingFinancialAccount: false });

    await fixture.service.create({
      authenticatedUserId: 'doctor-1',
      monthsPurchased: 1,
      idempotencyKey: 'idem-1',
    });

    expect(
      fixture.transaction.doctorFinancialAccount.create,
    ).toHaveBeenCalledTimes(1);
  });
});
