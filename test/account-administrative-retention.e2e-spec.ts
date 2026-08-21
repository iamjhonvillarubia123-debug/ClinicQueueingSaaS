import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from './../src/app.module';
import { AccountAdministrativeRetentionService } from './../src/privacy-retention/account-administrative-retention.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Account and administrative retention (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: AccountAdministrativeRetentionService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12s7-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 51).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 52).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 53).toString('base64'),
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
    retention = moduleFixture.get(AccountAdministrativeRetentionService);
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

  async function createClosedDoctor(
    label: string,
    occurredAt: Date,
    withFinancialAccount = false,
  ) {
    const unique = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `${label}-${unique}@example.test`,
        firstName: 'Retention',
        middleName: 'Private',
        lastName: 'Doctor',
        mobileNumber: `+63918${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: `legacy-password-${unique}`,
        role: 'DOCTOR',
        accountStatus: 'PERMANENTLY_CLOSED',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date('2019-01-01T00:00:00.000Z'),
        lastLoginAt: new Date('2019-12-31T00:00:00.000Z'),
        doctorFinancialAccount: withFinancialAccount
          ? {
              create: {
                recoveryEmailEncrypted: `preserved-encrypted-${unique}`,
                recoveryEmailHash: `preserved-hash-${unique}`,
              },
            }
          : undefined,
      },
      include: { doctorFinancialAccount: true },
    });

    const audit = await prisma.accountPermanentClosureAudit.create({
      data: {
        accountUserId: user.id,
        initiatedByUserId: user.id,
        closureType: 'DOCTOR_PERMANENT_CLOSURE',
        previousAccountStatus: 'ACTIVE',
        occurredAt,
      },
    });

    return { user, audit };
  }

  it('minimizes closed identity after seven days while preserving financial recovery data and audit evidence', async () => {
    const now = new Date('2020-01-20T12:00:00.000Z');
    const eligible = await createClosedDoctor(
      'm12s7-eligible',
      new Date(now.getTime() - 8 * DAY_MS),
      true,
    );
    const protectedWithinWindow = await createClosedDoctor(
      'm12s7-window',
      new Date(now.getTime() - 6 * DAY_MS),
    );

    const financialAccount = eligible.user.doctorFinancialAccount;
    if (!financialAccount) {
      throw new Error('M12S7 fixture did not create DoctorFinancialAccount.');
    }

    await retention.run(now, 1000);

    const [eligibleAfter, protectedAfter, accountAfter, eligibleAudit] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: eligible.user.id } }),
        prisma.user.findUniqueOrThrow({
          where: { id: protectedWithinWindow.user.id },
        }),
        prisma.doctorFinancialAccount.findUniqueOrThrow({
          where: { id: financialAccount.id },
        }),
        prisma.accountPermanentClosureAudit.findUniqueOrThrow({
          where: { id: eligible.audit.id },
        }),
      ]);

    expect(eligibleAfter.email).toMatch(/^closed-[a-f0-9]{20}@invalid\.local$/);
    expect(eligibleAfter.firstName).toBe('Closed');
    expect(eligibleAfter.middleName).toBeNull();
    expect(eligibleAfter.lastName).toBe('Account');
    expect(eligibleAfter.mobileNumber).toMatch(/^closed-[a-f0-9]{20}$/);
    expect(eligibleAfter.passwordHash).toMatch(/^!closed:[a-f0-9]{20}$/);
    expect(eligibleAfter.emailVerifiedAt).toBeNull();
    expect(eligibleAfter.lastLoginAt).toBeNull();
    expect(eligibleAfter.accountStatus).toBe('PERMANENTLY_CLOSED');

    expect(protectedAfter.email).toBe(protectedWithinWindow.user.email);
    expect(protectedAfter.firstName).toBe('Retention');
    expect(protectedAfter.middleName).toBe('Private');
    expect(protectedAfter.lastName).toBe('Doctor');
    expect(protectedAfter.mobileNumber).toBe(
      protectedWithinWindow.user.mobileNumber,
    );

    expect(accountAfter.recoveryEmailEncrypted).toBe(
      financialAccount.recoveryEmailEncrypted,
    );
    expect(accountAfter.recoveryEmailHash).toBe(
      financialAccount.recoveryEmailHash,
    );
    expect(accountAfter.doctorUserId).toBe(eligible.user.id);
    expect(eligibleAudit.accountUserId).toBe(eligible.user.id);

    const firstTombstone = {
      email: eligibleAfter.email,
      mobileNumber: eligibleAfter.mobileNumber,
      passwordHash: eligibleAfter.passwordHash,
    };

    await retention.run(now, 1000);
    const eligibleAfterReplay = await prisma.user.findUniqueOrThrow({
      where: { id: eligible.user.id },
    });

    expect({
      email: eligibleAfterReplay.email,
      mobileNumber: eligibleAfterReplay.mobileNumber,
      passwordHash: eligibleAfterReplay.passwordHash,
    }).toEqual(firstTombstone);
  });

  it('reports five-year audit eligibility without deleting account or administrative audit evidence', async () => {
    const now = new Date('2020-01-20T12:00:00.000Z');
    const oldOccurredAt = new Date('2014-01-20T12:00:00.000Z');
    const closed = await createClosedDoctor('m12s7-old-audit', oldOccurredAt);
    const unique = randomUUID();
    const admin = await prisma.user.create({
      data: {
        email: `m12s7-admin-${unique}@example.test`,
        firstName: 'System',
        lastName: 'Administrator',
        mobileNumber: `+63919${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: `admin-password-${unique}`,
        role: 'SYSTEM_ADMIN',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
      },
    });
    const target = await prisma.user.create({
      data: {
        email: `m12s7-target-${unique}@example.test`,
        firstName: 'Audit',
        lastName: 'Target',
        mobileNumber: `+63920${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: `target-password-${unique}`,
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
      },
    });
    const administrativeAction =
      await prisma.administrativeAccountAction.create({
        data: {
          actionType: 'NORMAL_SUSPENSION',
          actorUserId: admin.id,
          targetDoctorUserId: target.id,
          reasonCategory: 'SECURITY_CONCERN',
          explanation: 'M12S7 retained audit evidence fixture.',
          occurredAt: oldOccurredAt,
        },
      });

    const auditCutoff = new Date('2015-01-20T12:00:00.000Z');
    const [expectedClosureCount, expectedAdministrativeCount] =
      await Promise.all([
        prisma.accountPermanentClosureAudit.count({
          where: { occurredAt: { lte: auditCutoff } },
        }),
        prisma.administrativeAccountAction.count({
          where: { occurredAt: { lte: auditCutoff } },
        }),
      ]);

    const result = await retention.run(now, 1000);

    expect(result.closureAuditsAtBaseline).toBe(expectedClosureCount);
    expect(result.administrativeActionsAtBaseline).toBe(
      expectedAdministrativeCount,
    );
    expect(result.closureAuditsAtBaseline).toBeGreaterThanOrEqual(1);
    expect(result.administrativeActionsAtBaseline).toBeGreaterThanOrEqual(1);

    await expect(
      prisma.accountPermanentClosureAudit.findUniqueOrThrow({
        where: { id: closed.audit.id },
      }),
    ).resolves.toEqual(expect.objectContaining({ id: closed.audit.id }));
    await expect(
      prisma.administrativeAccountAction.findUniqueOrThrow({
        where: { id: administrativeAction.id },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: administrativeAction.id }),
    );
  });
});
