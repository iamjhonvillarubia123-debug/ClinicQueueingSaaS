import { ForbiddenException } from '@nestjs/common';
import { SubscriptionCommercialGateService } from './subscription-commercial-gate.service';

describe('SubscriptionCommercialGateService', () => {
  const now = new Date('2026-08-20T18:00:00.000Z');

  function createFixture() {
    const prisma = {
      doctorFinancialAccount: {
        findUnique: jest.fn(() => Promise.resolve({ id: 'financial-1' })),
      },
    };
    const entitlement = {
      evaluateForFinancialAccount: jest.fn(() =>
        Promise.resolve({
          hasEntitlementRecord: true,
          state: 'PAID' as const,
          paidThrough: new Date('2026-09-01T00:00:00.000Z'),
          graceEndsAt: new Date('2026-09-08T00:00:00.000Z'),
          allowsNewSubscriptionGatedActivity: true,
        }),
      ),
    };
    const service = new SubscriptionCommercialGateService(
      prisma as never,
      entitlement as never,
    );
    return { service, prisma, entitlement };
  }

  it('allows new activity while subscription state is PAID', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.assertAllowsNewActivity('doctor-1', now),
    ).resolves.toMatchObject({
      doctorUserId: 'doctor-1',
      doctorFinancialAccountId: 'financial-1',
      entitlement: { state: 'PAID' },
    });
    expect(fixture.entitlement.evaluateForFinancialAccount).toHaveBeenCalledWith(
      'financial-1',
      now,
    );
  });

  it('allows new activity during the seven-day grace state', async () => {
    const fixture = createFixture();
    fixture.entitlement.evaluateForFinancialAccount.mockResolvedValueOnce({
      hasEntitlementRecord: true,
      state: 'GRACE',
      paidThrough: new Date('2026-08-19T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-26T00:00:00.000Z'),
      allowsNewSubscriptionGatedActivity: true,
    });

    await expect(
      fixture.service.assertAllowsNewActivity('doctor-1', now),
    ).resolves.toMatchObject({ entitlement: { state: 'GRACE' } });
  });

  it('blocks new activity when no financial account exists', async () => {
    const fixture = createFixture();
    fixture.prisma.doctorFinancialAccount.findUnique.mockResolvedValueOnce(null);

    await expect(
      fixture.service.assertAllowsNewActivity('doctor-1', now),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.entitlement.evaluateForFinancialAccount).not.toHaveBeenCalled();
  });

  it('blocks new activity after unresolved grace expiry', async () => {
    const fixture = createFixture();
    fixture.entitlement.evaluateForFinancialAccount.mockResolvedValueOnce({
      hasEntitlementRecord: true,
      state: 'SUSPENDED',
      paidThrough: new Date('2026-08-12T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-19T00:00:00.000Z'),
      allowsNewSubscriptionGatedActivity: false,
    });

    await expect(
      fixture.service.assertAllowsNewActivity('doctor-1', now),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
