import { createHash, randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { FinancialAccountLockService } from './../src/financial/financial-account-lock.service';
import { SubscriptionCreditRecoveryService } from './../src/financial/subscription-credit-recovery.service';
import { PrismaService } from './../src/prisma/prisma.service';

const SESSION_TTL_MS = 30 * 60 * 1000;

describe('Subscription credit recovery concurrency (e2e)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let recovery: SubscriptionCreditRecoveryService;
  let accountLocks: FinancialAccountLockService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm10-credit-recovery-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 111).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 112).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm10-recovery-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm10-recovery-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 113).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm10-recovery-otp-hmac-v1',
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
    recovery = moduleFixture.get(SubscriptionCreditRecoveryService);
    accountLocks = moduleFixture.get(FinancialAccountLockService);
  });

  afterAll(async () => {
    await moduleFixture.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('allows only one historical-credit transfer pair under concurrent distinct commands', async () => {
    const fixture = await createRecoveryFixture('300.00');
    const recoveredAt = new Date('2026-08-21T12:00:00.000Z');

    const results = await Promise.allSettled([
      recovery.recover({
        authenticatedUserId: fixture.targetUserId,
        historicalDoctorFinancialAccountId: fixture.sourceFinancialAccountId,
        financialAccessToken: fixture.financialAccessToken,
        idempotencyKey: `recover-a-${randomUUID()}`,
        recoveredAt,
      }),
      recovery.recover({
        authenticatedUserId: fixture.targetUserId,
        historicalDoctorFinancialAccountId: fixture.sourceFinancialAccountId,
        financialAccessToken: fixture.financialAccessToken,
        idempotencyKey: `recover-b-${randomUUID()}`,
        recoveredAt,
      }),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      BadRequestException,
    );

    const transferEntries = await prisma.subscriptionCreditEntry.findMany({
      where: {
        OR: [
          {
            doctorFinancialAccountId: fixture.sourceFinancialAccountId,
            entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
          },
          {
            doctorFinancialAccountId: fixture.targetFinancialAccountId,
            entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
          },
        ],
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(transferEntries).toHaveLength(2);

    const transferOut = transferEntries.find(
      (entry) =>
        entry.entryType === SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
    );
    const transferIn = transferEntries.find(
      (entry) =>
        entry.entryType === SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
    );
    expect(transferOut?.amount.toFixed(2)).toBe('300.00');
    expect(transferIn?.amount.toFixed(2)).toBe('300.00');
    expect(transferOut?.doctorFinancialAccountId).toBe(
      fixture.sourceFinancialAccountId,
    );
    expect(transferIn?.doctorFinancialAccountId).toBe(
      fixture.targetFinancialAccountId,
    );
    expect(transferIn?.relatedCreditEntryId).toBe(transferOut?.id);
    expect(transferOut?.commandIdempotencyId).toBe(
      transferIn?.commandIdempotencyId,
    );

    const sourceEntries = await prisma.subscriptionCreditEntry.findMany({
      where: { doctorFinancialAccountId: fixture.sourceFinancialAccountId },
    });
    const sourceNet = sourceEntries.reduce(
      (total, entry) =>
        entry.entryType === SubscriptionCreditEntryType.CREDIT_CREATED
          ? total + Number(entry.amount.toFixed(2))
          : entry.entryType ===
              SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT
            ? total - Number(entry.amount.toFixed(2))
            : total,
      0,
    );
    expect(sourceNet).toBe(0);
  }, 30_000);

  it('locks the same account pair in deterministic order for opposite caller order', async () => {
    const fixture = await createAccountPair();

    await expect(
      Promise.all([
        prisma.$transaction(async (transaction) => {
          const locked = await accountLocks.lockPair(
            transaction,
            fixture.firstFinancialAccountId,
            fixture.secondFinancialAccountId,
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
          return locked.map((account) => account.id);
        }),
        prisma.$transaction(async (transaction) => {
          const locked = await accountLocks.lockPair(
            transaction,
            fixture.secondFinancialAccountId,
            fixture.firstFinancialAccountId,
          );
          return locked.map((account) => account.id);
        }),
      ]),
    ).resolves.toEqual([
      [fixture.firstFinancialAccountId, fixture.secondFinancialAccountId],
      [fixture.secondFinancialAccountId, fixture.firstFinancialAccountId],
    ]);
  }, 30_000);

  async function createRecoveryFixture(amount: string) {
    const scope = randomUUID().replaceAll('-', '');
    const sourceUser = await prisma.user.create({
      data: {
        email: `m10-recovery-old-${scope.slice(0, 10)}@example.test`,
        firstName: 'Historical',
        lastName: 'Doctor',
        mobileNumber: `0916${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const targetUser = await prisma.user.create({
      data: {
        email: `m10-recovery-new-${scope.slice(0, 10)}@example.test`,
        firstName: 'Current',
        lastName: 'Doctor',
        mobileNumber: `0915${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const sourceFinancialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: sourceUser.id },
    });
    const targetFinancialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: targetUser.id },
    });
    await prisma.subscriptionCreditEntry.create({
      data: {
        doctorFinancialAccountId: sourceFinancialAccount.id,
        entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
        amount,
        occurredAt: new Date('2026-08-20T12:00:00.000Z'),
      },
    });

    const recoveryEmailHash = createHash('sha256')
      .update(`recovery-${scope}@example.test`, 'utf8')
      .digest('hex');
    const challenge = await prisma.financialAccessChallenge.create({
      data: {
        recoveryEmailHash,
        recipientEmailEncrypted: 'e2e-encrypted-email-placeholder',
        codeHash: 'e2e-code-hash-placeholder',
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        verifiedAt: new Date(),
        consumedAt: new Date(),
      },
    });
    const financialAccessToken = `m10-recovery-token-${randomUUID()}`;
    const tokenHash = createHash('sha256')
      .update(financialAccessToken, 'utf8')
      .digest('hex');
    await prisma.financialAccessSession.create({
      data: {
        doctorFinancialAccountId: sourceFinancialAccount.id,
        sourceChallengeId: challenge.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    return {
      sourceFinancialAccountId: sourceFinancialAccount.id,
      targetFinancialAccountId: targetFinancialAccount.id,
      targetUserId: targetUser.id,
      financialAccessToken,
    };
  }

  async function createAccountPair() {
    const scope = randomUUID().replaceAll('-', '');
    const firstUser = await prisma.user.create({
      data: {
        email: `m10-lock-first-${scope.slice(0, 10)}@example.test`,
        firstName: 'First',
        lastName: 'Doctor',
        mobileNumber: `0914${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const secondUser = await prisma.user.create({
      data: {
        email: `m10-lock-second-${scope.slice(0, 10)}@example.test`,
        firstName: 'Second',
        lastName: 'Doctor',
        mobileNumber: `0913${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const firstFinancialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: firstUser.id },
    });
    const secondFinancialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: secondUser.id },
    });
    return {
      firstFinancialAccountId: firstFinancialAccount.id,
      secondFinancialAccountId: secondFinancialAccount.id,
    };
  }
});
