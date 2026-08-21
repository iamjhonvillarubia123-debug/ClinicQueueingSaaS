import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { DoctorLifecycleService } from './../src/doctor/doctor-lifecycle.service';
import { SubscriptionPeriodService } from './../src/financial/subscription-period.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Doctor permanent closure financial settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lifecycle: DoctorLifecycleService;
  let periods: SubscriptionPeriodService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12s6-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 41).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 42).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 43).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };

  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      if (!process.env[key]) process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    lifecycle = moduleFixture.get(DoctorLifecycleService);
    periods = moduleFixture.get(SubscriptionPeriodService);
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function createDoctorFixture() {
    const unique = randomUUID();
    const password = 'M12S6 closure password 42!';
    const email = `m12s6-${unique}@example.test`;
    const doctor = await prisma.user.create({
      data: {
        email,
        firstName: 'Closure',
        lastName: 'Doctor',
        mobileNumber: `+63917${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `M12S6-${unique}`,
          },
        },
        doctorFinancialAccount: { create: {} },
      },
      include: { doctorFinancialAccount: true },
    });

    if (!doctor.doctorFinancialAccount) {
      throw new Error('M12S6 fixture did not create DoctorFinancialAccount.');
    }

    return {
      doctor,
      password,
      financialAccountId: doctor.doctorFinancialAccount.id,
    };
  }

  it('blocks permanent closure while a subscription purchase remains unresolved', async () => {
    const fixture = await createDoctorFixture();
    const now = new Date();
    const periodEnd = periods.addCalendarMonths(now, 1);

    await prisma.subscriptionPurchase.create({
      data: {
        doctorFinancialAccountId: fixture.financialAccountId,
        purchasedByUserId: fixture.doctor.id,
        monthsPurchased: 1,
        monthlyPriceSnapshot: '1000.00',
        grossAmount: '1000.00',
        creditAmountApplied: '0.00',
        externalAmountRequired: '1000.00',
        periodStart: now,
        periodEnd,
        status: 'PENDING',
        createdAt: now,
      },
    });

    await expect(
      lifecycle.permanentlyDelete(
        fixture.doctor.email,
        fixture.password,
        true,
        `m12s6-pending-${randomUUID()}`,
      ),
    ).rejects.toThrow(
      'Permanent closure is unavailable while a subscription purchase is still pending.',
    );

    const [user, account, auditCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: fixture.doctor.id } }),
      prisma.doctorFinancialAccount.findUniqueOrThrow({
        where: { id: fixture.financialAccountId },
      }),
      prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: fixture.doctor.id },
      }),
    ]);

    expect(user.accountStatus).toBe('ACTIVE');
    expect(account.recoveryEmailEncrypted).toBeNull();
    expect(account.recoveryEmailHash).toBeNull();
    expect(auditCount).toBe(0);
  });

  it('preserves historical financial ownership and credits fully unused future periods exactly once', async () => {
    const fixture = await createDoctorFixture();
    const now = new Date();
    const futureStart = new Date(now.getTime() + 10 * DAY_MS);
    const futureEnd = periods.addCalendarMonths(futureStart, 2);
    const purchase = await prisma.subscriptionPurchase.create({
      data: {
        doctorFinancialAccountId: fixture.financialAccountId,
        purchasedByUserId: fixture.doctor.id,
        monthsPurchased: 2,
        monthlyPriceSnapshot: '1234.56',
        grossAmount: '2469.12',
        creditAmountApplied: '0.00',
        externalAmountRequired: '2469.12',
        periodStart: futureStart,
        periodEnd: futureEnd,
        status: 'COMPLETED',
        completedAt: now,
        createdAt: now,
      },
    });
    const idempotencyKey = `m12s6-close-${randomUUID()}`;

    await expect(
      lifecycle.permanentlyDelete(
        fixture.doctor.email,
        fixture.password,
        true,
        idempotencyKey,
      ),
    ).resolves.toEqual({
      permanentlyClosed: true,
      replayed: false,
      publicRouteRetired: true,
    });

    await expect(
      lifecycle.permanentlyDelete(
        fixture.doctor.email,
        fixture.password,
        true,
        idempotencyKey,
      ),
    ).resolves.toEqual({
      permanentlyClosed: true,
      replayed: true,
      publicRouteRetired: true,
    });

    const [user, account, creditEntries, auditCount, closureCommands] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: fixture.doctor.id } }),
        prisma.doctorFinancialAccount.findUniqueOrThrow({
          where: { id: fixture.financialAccountId },
        }),
        prisma.subscriptionCreditEntry.findMany({
          where: {
            doctorFinancialAccountId: fixture.financialAccountId,
            subscriptionPurchaseId: purchase.id,
            entryType: 'CREDIT_CREATED',
          },
        }),
        prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: fixture.doctor.id },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            accountUserId: fixture.doctor.id,
            commandType: 'DOCTOR_DELETE_ACCOUNT',
          },
        }),
      ]);

    expect(user.accountStatus).toBe('PERMANENTLY_CLOSED');
    expect(account.doctorUserId).toBe(fixture.doctor.id);
    expect(account.recoveryEmailEncrypted).not.toBeNull();
    expect(account.recoveryEmailHash).toBe(
      createHash('sha256')
        .update(fixture.doctor.email.trim().toLowerCase(), 'utf8')
        .digest('hex'),
    );
    expect(creditEntries).toHaveLength(1);
    expect(creditEntries[0]?.amount.toFixed(2)).toBe('2469.12');
    expect(auditCount).toBe(1);
    expect(closureCommands).toHaveLength(1);
    expect(closureCommands[0]?.doctorFinancialAccountId).toBe(
      fixture.financialAccountId,
    );
  });
});
