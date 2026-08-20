import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  NotificationType,
  SubscriptionEntitlementEventType,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { SubscriptionEntitlementTransitionService } from './../src/financial/subscription-entitlement-transition.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Subscription entitlement transition concurrency (e2e)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let transitions: SubscriptionEntitlementTransitionService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm10-transition-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 91).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 92).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm10-transition-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm10-transition-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 93).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm10-transition-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleFixture.get(PrismaService);
    transitions = moduleFixture.get(SubscriptionEntitlementTransitionService);
  });

  afterAll(async () => {
    await moduleFixture.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('materializes one GRACE_ENTERED event and one outbox under concurrent reconciliation', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const financialAccountId = await createEntitlementFixture({
      paidThrough: new Date(now.getTime() - DAY_MS),
      graceEndsAt: new Date(now.getTime() + 6 * DAY_MS),
    });

    const results = await Promise.all([
      transitions.reconcileFinancialAccount(financialAccountId, now),
      transitions.reconcileFinancialAccount(financialAccountId, now),
    ]);

    expect(results.map((result) => result.state)).toEqual(['GRACE', 'GRACE']);

    const events = await prisma.subscriptionEntitlementEvent.findMany({
      where: {
        doctorFinancialAccountId: financialAccountId,
        eventType: SubscriptionEntitlementEventType.GRACE_ENTERED,
      },
    });
    expect(events).toHaveLength(1);

    const outboxes = await prisma.notificationOutbox.findMany({
      where: {
        subscriptionEntitlementEventId: events[0].id,
        notificationType: NotificationType.SUBSCRIPTION_GRACE_ENTERED,
      },
    });
    expect(outboxes).toHaveLength(1);
  }, 30_000);

  it('materializes one SUSPENDED event and one outbox under concurrent reconciliation', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const financialAccountId = await createEntitlementFixture({
      paidThrough: new Date(now.getTime() - 8 * DAY_MS),
      graceEndsAt: new Date(now.getTime() - DAY_MS),
    });

    const results = await Promise.all([
      transitions.reconcileFinancialAccount(financialAccountId, now),
      transitions.reconcileFinancialAccount(financialAccountId, now),
    ]);

    expect(results.map((result) => result.state)).toEqual([
      'SUSPENDED',
      'SUSPENDED',
    ]);

    const events = await prisma.subscriptionEntitlementEvent.findMany({
      where: {
        doctorFinancialAccountId: financialAccountId,
        eventType: SubscriptionEntitlementEventType.SUSPENDED,
      },
    });
    expect(events).toHaveLength(1);

    const outboxes = await prisma.notificationOutbox.findMany({
      where: {
        subscriptionEntitlementEventId: events[0].id,
        notificationType: NotificationType.SUBSCRIPTION_SUSPENDED,
      },
    });
    expect(outboxes).toHaveLength(1);
  }, 30_000);

  async function createEntitlementFixture(input: {
    paidThrough: Date;
    graceEndsAt: Date;
  }): Promise<string> {
    const scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m10-transition-${scope.slice(0, 12)}@example.test`,
        firstName: 'Transition',
        lastName: 'Doctor',
        mobileNumber: `0917${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctor.id },
    });
    await prisma.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        paidThrough: input.paidThrough,
        graceEndsAt: input.graceEndsAt,
      },
    });
    return financialAccount.id;
  }
});
