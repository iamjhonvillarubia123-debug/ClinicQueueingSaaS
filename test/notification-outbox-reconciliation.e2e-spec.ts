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
import { NotificationProviderReconciliationOutcome } from './../src/notification/notification-provider-adapter';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Notification uncertain reconciliation persistence controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let attemptService: NotificationDeliveryAttemptService;
  let reconciliationService: NotificationOutboxReconciliationService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9s3-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 111).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 112).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9s3-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9s3-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 113).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9s3-otp-hmac-v1',
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

  it('reconciles an expired uncertain attempt to sent without rewriting or duplicating attempt history', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const deliveryIdentityKey = createHash('sha256')
      .update(`m9s3|${scope}`, 'utf8')
      .digest('hex');
    const commandIdentityKey = createHash('sha256')
      .update(`m9s3-command|${scope}`, 'utf8')
      .digest('hex');
    const providerIdempotencyKey = `m9s3-provider-${scope}`;

    const doctor = await prisma.user.create({
      data: {
        email: `m9s3-${scope}@example.test`,
        firstName: 'M9S3',
        lastName: 'Doctor',
        mobileNumber: `+63919${scope.slice(0, 7)}`,
        passwordHash: 'm9s3-e2e-fixture-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });

    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m9s3-${scope}`,
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
        providerIdempotencyKey,
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
        providerName: 'provider-a',
        providerReference: `provider-ref-${scope}`,
        providerStatus: 'submission-unknown',
        submittedAt: now,
      },
      now,
    );

    const uncertainLogsBefore = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(uncertainLogsBefore).toHaveLength(1);
    expect(uncertainLogsBefore[0].attemptNumber).toBe(1);
    expect(uncertainLogsBefore[0].outcome).toBe(
      NotificationAttemptOutcome.UNCERTAIN,
    );
    expect(uncertainLogsBefore[0].resolvedAt).toBeNull();

    const isolatedProcessingStartedAt = new Date('2000-01-01T00:00:00.000Z');
    const isolatedLeaseExpiresAt = new Date('2000-01-01T00:01:00.000Z');
    await prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        processingStartedAt: isolatedProcessingStartedAt,
        leaseExpiresAt: isolatedLeaseExpiresAt,
      },
    });

    const reconciliationNow = new Date(now.getTime() + 61_000);
    const reconciliationWorkerId = `reconcile-${scope.slice(0, 8)}`;
    const candidate = await reconciliationService.claimExpiredForReconciliation(
      reconciliationWorkerId,
      60_000,
      reconciliationNow,
    );

    expect(candidate?.id).toBe(outbox.id);
    expect(candidate?.latestAttemptNumber).toBe(1);
    expect(candidate?.providerReference).toBe(`provider-ref-${scope}`);

    const providerConfirmedAt = new Date(reconciliationNow.getTime() - 1_000);
    await reconciliationService.applyReconciliation(
      outbox.id,
      reconciliationWorkerId,
      {
        outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
        providerConfirmedAt,
      },
      reconciliationNow,
    );

    const finalOutbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(finalOutbox.status).toBe(NotificationOutboxStatus.SENT);
    expect(finalOutbox.attemptCount).toBe(1);
    expect(finalOutbox.sentAt?.getTime()).toBe(providerConfirmedAt.getTime());
    expect(finalOutbox.processingStartedAt).toBeNull();
    expect(finalOutbox.leaseExpiresAt).toBeNull();
    expect(finalOutbox.processingWorkerId).toBeNull();

    const logsAfter = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
      orderBy: { attemptNumber: 'asc' },
    });

    expect(logsAfter).toHaveLength(1);
    expect(logsAfter[0].id).toBe(uncertainLogsBefore[0].id);
    expect(logsAfter[0].attemptNumber).toBe(1);
    expect(logsAfter[0].outcome).toBe(NotificationAttemptOutcome.UNCERTAIN);
    expect(logsAfter[0].resolvedAt).toBeNull();
    expect(logsAfter[0].providerIdempotencyKeyUsed).toBe(
      providerIdempotencyKey,
    );
  }, 30_000);
});
