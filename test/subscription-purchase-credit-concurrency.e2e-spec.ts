import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { SubscriptionPurchaseService } from './../src/financial/subscription-purchase.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Subscription purchase credit concurrency (e2e)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let purchases: SubscriptionPurchaseService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm10-purchase-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 101).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 102).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm10-purchase-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm10-purchase-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 103).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm10-purchase-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
    SUBSCRIPTION_MONTHLY_PRICE: '100.00',
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
    purchases = moduleFixture.get(SubscriptionPurchaseService);
  });

  afterAll(async () => {
    await moduleFixture.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('serializes concurrent purchases so one credit balance cannot be reserved twice', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m10-purchase-${scope.slice(0, 12)}@example.test`,
        firstName: 'Purchase',
        lastName: 'Doctor',
        mobileNumber: `0918${scope.slice(0, 7)}`,
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
    await prisma.subscriptionCreditEntry.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
        amount: new Prisma.Decimal('100.00'),
        occurredAt: new Date(),
      },
    });

    const results = await Promise.all([
      purchases.create({
        authenticatedUserId: doctor.id,
        monthsPurchased: 1,
        idempotencyKey: `purchase-a-${scope}`,
      }),
      purchases.create({
        authenticatedUserId: doctor.id,
        monthsPurchased: 1,
        idempotencyKey: `purchase-b-${scope}`,
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.replayed === false)).toBe(true);

    const createdPurchases = await prisma.subscriptionPurchase.findMany({
      where: { doctorFinancialAccountId: financialAccount.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(createdPurchases).toHaveLength(2);
    expect(
      createdPurchases
        .map((purchase) => purchase.creditAmountApplied.toFixed(2))
        .sort(),
    ).toEqual(['0.00', '100.00']);
    expect(
      createdPurchases
        .map((purchase) => purchase.externalAmountRequired.toFixed(2))
        .sort(),
    ).toEqual(['0.00', '100.00']);

    const reservations = await prisma.subscriptionCreditEntry.findMany({
      where: {
        doctorFinancialAccountId: financialAccount.id,
        entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
      },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].amount.toFixed(2)).toBe('100.00');

    const reservedTotal = reservations.reduce(
      (total, entry) => total.plus(entry.amount),
      new Prisma.Decimal(0),
    );
    expect(reservedTotal.toFixed(2)).toBe('100.00');
  }, 30_000);
});
