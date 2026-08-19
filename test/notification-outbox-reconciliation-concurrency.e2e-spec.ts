import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  CommandType,
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { NotificationDeliveryAttemptService } from './../src/notification/notification-delivery-attempt.service';
import { NotificationOutboxReconciliationService } from './../src/notification/notification-outbox-reconciliation.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('NotificationOutbox reconciliation claim concurrency controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let attemptService: NotificationDeliveryAttemptService;
  let reconciliationService: NotificationOutboxReconciliationService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9-reconciliation-race-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 121).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 122).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9-race-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9-race-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 123).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9-race-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    attemptService = moduleFixture.get(NotificationDeliveryAttemptService);
    reconciliationService = moduleFixture.get(
      NotificationOutboxReconciliationService,
    );
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lets only one reconciliation worker claim the same expired uncertain outbox', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const deliveryIdentityKey = createHash('sha256')
      .update(`m9-reconciliation-race|${scope}`, 'utf8')
      .digest('hex');
    const commandIdentityKey = createHash('sha256')
      .update(`m9-reconciliation-race-command|${scope}`, 'utf8')
      .digest('hex');

    const doctor = await prisma.user.create({
      data: {
        email: `m9-reconciliation-race-${scope}@example.test`,
        firstName: 'M9',
        lastName: 'Race',
        mobileNumber: `+63918${scope.slice(0, 7)}`,
        passwordHash: 'm9-reconciliation-race-fixture-hash',
        role: UserRole.DOCTOR,
      },
    });

    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m9-reconciliation-race-${scope}`,
        commandIdentityKey,
        commandType: CommandType.DOCTOR_DISABLE_ACCOUNT,
        requestFingerprint: deliveryIdentityKey,
        actorUserId: doctor.id,
        accountUserId: doctor.id,
        completedAt: now,
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
        createdAt: now,
      },
    });

    const submissionWorkerId = `submit-${scope.slice(0, 8)}`;
    const outbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: NotificationType.SECURITY_NOTIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PROCESSING,
        practiceLocationId: null,
        commandIdempotencyId: command.id,
        recipientMobileEncrypted: `enc-${scope}`,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: `message-${scope}`,
        providerIdempotencyKey: `m9-race-provider-${scope}`,
        attemptCount: 0,
        processingStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        processingWorkerId: submissionWorkerId,
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    await attemptService.finalizeAttempt(
      outbox.id,
      submissionWorkerId,
      {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: 'provider-race',
        providerReference: `provider-race-ref-${scope}`,
        providerStatus: 'submission-unknown',
        submittedAt: now,
      },
      now,
    );

    const processingStartedAt = new Date('1990-01-01T00:00:00.000Z');
    const expiredLease = new Date('1990-01-01T00:01:00.000Z');
    await prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        processingStartedAt,
        leaseExpiresAt: expiredLease,
      },
    });

    const reconciliationNow = new Date(now.getTime() + 120_000);
    const [workerA, workerB] = await Promise.all([
      reconciliationService.claimExpiredForReconciliation(
        `reconcile-a-${scope.slice(0, 8)}`,
        60_000,
        reconciliationNow,
      ),
      reconciliationService.claimExpiredForReconciliation(
        `reconcile-b-${scope.slice(0, 8)}`,
        60_000,
        reconciliationNow,
      ),
    ]);

    const targetClaims = [workerA, workerB].filter(
      (value): value is NonNullable<typeof value> => value?.id === outbox.id,
    );
    expect(targetClaims).toHaveLength(1);

    const stored = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(stored.status).toBe(NotificationOutboxStatus.PROCESSING);
    expect(stored.processingWorkerId).toBe(targetClaims[0].processingWorkerId);
    expect(stored.processingStartedAt?.getTime()).toBe(
      processingStartedAt.getTime(),
    );
    expect(stored.leaseExpiresAt?.getTime()).toBe(
      reconciliationNow.getTime() + 60_000,
    );

    const logs = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].attemptNumber).toBe(1);
    expect(logs[0].outcome).toBe(NotificationAttemptOutcome.UNCERTAIN);
  }, 30_000);
});
