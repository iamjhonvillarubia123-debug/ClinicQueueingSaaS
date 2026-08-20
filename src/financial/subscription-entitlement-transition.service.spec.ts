import {
  NotificationType,
  SubscriptionEntitlementEventType,
} from '../../generated/prisma/client';
import { SubscriptionEntitlementTransitionService } from './subscription-entitlement-transition.service';

type EntitlementState = 'PAID' | 'GRACE' | 'SUSPENDED';
type ExistingEvent = { id: string } | null;
type ExistingOutbox = { id: string } | null;
type EntitlementRow = {
  id: string;
  doctorFinancialAccountId: string;
  paidThrough: Date;
  graceEndsAt: Date;
} | null;
type CreatedEvent = { id: string };
type CreatedOutbox = { id: string };
type FinancialAccountRow = {
  doctorUser: { email: string };
} | null;
type EventCreateInput = {
  data: {
    eventType: SubscriptionEntitlementEventType;
    effectiveAt: Date;
  };
};
type OutboxCreateInput = {
  data: {
    notificationType: NotificationType;
    subscriptionEntitlementEventId: string;
  };
};

describe('SubscriptionEntitlementTransitionService', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  function createFixture() {
    const transaction = {
      doctorSubscriptionEntitlement: {
        findUnique: jest.fn<Promise<EntitlementRow>, []>(() =>
          Promise.resolve(null),
        ),
      },
      subscriptionEntitlementEvent: {
        findFirst: jest.fn<Promise<ExistingEvent>, []>(() =>
          Promise.resolve(null),
        ),
        create: jest.fn<Promise<CreatedEvent>, [EventCreateInput]>(() =>
          Promise.resolve({ id: 'event-1' }),
        ),
      },
      notificationOutbox: {
        findUnique: jest.fn<Promise<ExistingOutbox>, []>(() =>
          Promise.resolve(null),
        ),
        create: jest.fn<Promise<CreatedOutbox>, [OutboxCreateInput]>(() =>
          Promise.resolve({ id: 'outbox-1' }),
        ),
      },
      doctorFinancialAccount: {
        findUnique: jest.fn<Promise<FinancialAccountRow>, []>(() =>
          Promise.resolve({ doctorUser: { email: 'doctor@example.com' } }),
        ),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
      doctorSubscriptionEntitlement: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const accountLocks = {
      lockById: jest.fn(() => Promise.resolve()),
    };
    const entitlementState = {
      evaluateDates: jest.fn<EntitlementState, [Date, Date, Date]>(
        () => 'GRACE',
      ),
    };
    const protectedAccountPayload = {
      encrypt: jest.fn(() => 'encrypted-email'),
    };
    const notificationPayload = {
      encryptMessage: jest.fn(() => 'encrypted-message'),
    };
    const service = new SubscriptionEntitlementTransitionService(
      prisma as never,
      accountLocks as never,
      entitlementState as never,
      protectedAccountPayload as never,
      notificationPayload as never,
    );
    return {
      service,
      prisma,
      transaction,
      accountLocks,
      entitlementState,
    };
  }

  it('creates exactly one GRACE_ENTERED event at paidThrough and its email intent', async () => {
    const fixture = createFixture();
    const paidThrough = new Date('2026-08-20T00:00:00.000Z');
    const graceEndsAt = new Date('2026-08-27T00:00:00.000Z');
    const entitlement: Exclude<EntitlementRow, null> = {
      id: 'entitlement-1',
      doctorFinancialAccountId: 'financial-1',
      paidThrough,
      graceEndsAt,
    };
    fixture.transaction.doctorSubscriptionEntitlement.findUnique.mockResolvedValueOnce(
      entitlement,
    );

    await expect(
      fixture.service.reconcileFinancialAccount('financial-1', now),
    ).resolves.toMatchObject({ state: 'GRACE', created: true });

    const eventCreate =
      fixture.transaction.subscriptionEntitlementEvent.create.mock.calls[0]?.[0];
    expect(eventCreate?.data.eventType).toBe(
      SubscriptionEntitlementEventType.GRACE_ENTERED,
    );
    expect(eventCreate?.data.effectiveAt).toEqual(paidThrough);

    const outboxCreate =
      fixture.transaction.notificationOutbox.create.mock.calls[0]?.[0];
    expect(outboxCreate?.data.notificationType).toBe(
      NotificationType.SUBSCRIPTION_GRACE_ENTERED,
    );
    expect(outboxCreate?.data.subscriptionEntitlementEventId).toBe(
      'event-1',
    );
  });

  it('creates SUSPENDED without manufacturing a late grace event', async () => {
    const fixture = createFixture();
    fixture.entitlementState.evaluateDates.mockReturnValueOnce('SUSPENDED');
    const paidThrough = new Date('2026-08-10T00:00:00.000Z');
    const graceEndsAt = new Date('2026-08-17T00:00:00.000Z');
    const entitlement: Exclude<EntitlementRow, null> = {
      id: 'entitlement-1',
      doctorFinancialAccountId: 'financial-1',
      paidThrough,
      graceEndsAt,
    };
    fixture.transaction.doctorSubscriptionEntitlement.findUnique.mockResolvedValueOnce(
      entitlement,
    );

    await fixture.service.reconcileFinancialAccount('financial-1', now);

    const eventCreate =
      fixture.transaction.subscriptionEntitlementEvent.create.mock.calls[0]?.[0];
    expect(eventCreate?.data.eventType).toBe(
      SubscriptionEntitlementEventType.SUSPENDED,
    );
    expect(eventCreate?.data.effectiveAt).toEqual(graceEndsAt);
    expect(
      fixture.transaction.subscriptionEntitlementEvent.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing transition occurrence and does not create another event', async () => {
    const fixture = createFixture();
    const entitlement: Exclude<EntitlementRow, null> = {
      id: 'entitlement-1',
      doctorFinancialAccountId: 'financial-1',
      paidThrough: new Date('2026-08-20T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-27T00:00:00.000Z'),
    };
    fixture.transaction.doctorSubscriptionEntitlement.findUnique.mockResolvedValueOnce(
      entitlement,
    );
    fixture.transaction.subscriptionEntitlementEvent.findFirst.mockResolvedValueOnce(
      { id: 'existing-event' },
    );
    fixture.transaction.notificationOutbox.findUnique.mockResolvedValueOnce({
      id: 'existing-outbox',
    });

    await expect(
      fixture.service.reconcileFinancialAccount('financial-1', now),
    ).resolves.toMatchObject({
      created: false,
      event: { id: 'existing-event' },
    });
    expect(
      fixture.transaction.subscriptionEntitlementEvent.create,
    ).not.toHaveBeenCalled();
    expect(
      fixture.transaction.notificationOutbox.create,
    ).not.toHaveBeenCalled();
  });

  it('does nothing while entitlement is still PAID', async () => {
    const fixture = createFixture();
    fixture.entitlementState.evaluateDates.mockReturnValueOnce('PAID');
    const entitlement: Exclude<EntitlementRow, null> = {
      id: 'entitlement-1',
      doctorFinancialAccountId: 'financial-1',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      graceEndsAt: new Date('2026-09-08T00:00:00.000Z'),
    };
    fixture.transaction.doctorSubscriptionEntitlement.findUnique.mockResolvedValueOnce(
      entitlement,
    );

    await expect(
      fixture.service.reconcileFinancialAccount('financial-1', now),
    ).resolves.toMatchObject({ state: 'PAID', event: null, created: false });
    expect(
      fixture.transaction.subscriptionEntitlementEvent.create,
    ).not.toHaveBeenCalled();
    expect(
      fixture.transaction.notificationOutbox.create,
    ).not.toHaveBeenCalled();
  });
});
