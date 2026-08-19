import { InternalServerErrorException } from '@nestjs/common';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('SubscriptionEntitlementService', () => {
  function createService(
    entitlement:
      | { paidThrough: Date; graceEndsAt: Date }
      | null = null,
  ) {
    const prisma = {
      doctorSubscriptionEntitlement: {
        findUnique: jest.fn(() => Promise.resolve(entitlement)),
      },
    };

    return {
      service: new SubscriptionEntitlementService(prisma as never),
      prisma,
    };
  }

  it('treats absence of an entitlement record as ineligible for new gated activity', async () => {
    const { service } = createService();

    await expect(
      service.evaluateForFinancialAccount(
        'account-1',
        new Date('2026-08-19T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      hasEntitlementRecord: false,
      state: null,
      paidThrough: null,
      graceEndsAt: null,
      allowsNewSubscriptionGatedActivity: false,
    });
  });

  it('derives PAID before the paid-through boundary', () => {
    const { service } = createService();
    const paidThrough = new Date('2026-09-01T00:00:00.000Z');
    const graceEndsAt = new Date(paidThrough.getTime() + 7 * DAY_MS);

    expect(
      service.evaluateDates(
        paidThrough,
        graceEndsAt,
        new Date('2026-08-31T23:59:59.999Z'),
      ),
    ).toBe('PAID');
  });

  it('derives GRACE from paid-through until the seven-day grace boundary', () => {
    const { service } = createService();
    const paidThrough = new Date('2026-09-01T00:00:00.000Z');
    const graceEndsAt = new Date(paidThrough.getTime() + 7 * DAY_MS);

    expect(service.evaluateDates(paidThrough, graceEndsAt, paidThrough)).toBe(
      'GRACE',
    );
    expect(
      service.evaluateDates(
        paidThrough,
        graceEndsAt,
        new Date(graceEndsAt.getTime() - 1),
      ),
    ).toBe('GRACE');
  });

  it('derives SUSPENDED at and after grace expiry', () => {
    const { service } = createService();
    const paidThrough = new Date('2026-09-01T00:00:00.000Z');
    const graceEndsAt = new Date(paidThrough.getTime() + 7 * DAY_MS);

    expect(
      service.evaluateDates(paidThrough, graceEndsAt, graceEndsAt),
    ).toBe('SUSPENDED');
  });

  it('rejects entitlement dates that violate the fixed seven-day grace invariant', () => {
    const { service } = createService();
    const paidThrough = new Date('2026-09-01T00:00:00.000Z');
    const graceEndsAt = new Date(paidThrough.getTime() + 6 * DAY_MS);

    expect(() =>
      service.evaluateDates(paidThrough, graceEndsAt),
    ).toThrow(InternalServerErrorException);
  });

  it('returns current entitlement dates and gated eligibility', async () => {
    const paidThrough = new Date('2026-09-01T00:00:00.000Z');
    const graceEndsAt = new Date(paidThrough.getTime() + 7 * DAY_MS);
    const { service } = createService({ paidThrough, graceEndsAt });

    await expect(
      service.evaluateForFinancialAccount(
        'account-1',
        new Date('2026-09-02T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      hasEntitlementRecord: true,
      state: 'GRACE',
      paidThrough,
      graceEndsAt,
      allowsNewSubscriptionGatedActivity: true,
    });
  });
});
