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
import { NotificationOutboxReconciliationService } from './../src/notification/notification-outbox-reconciliation.service';
import { NotificationProviderReconciliationOutcome } from './../src/notification/notification-provider-adapter';
import { NotificationSubmissionBoundaryService } from './../src/notification/notification-submission-boundary.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Notification provider submission boundary crash recovery (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let submissionBoundary: NotificationSubmissionBoundaryService;
  let reconciliationService: NotificationOutboxReconciliationService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9-submission-boundary-e2e-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 121).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 122).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9-submission-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9-submission-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 123).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9-submission-otp-v1',
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
    submissionBoundary = moduleFixture.get(
      NotificationSubmissionBoundaryService,
    );
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

  it('recovers a reserved provider attempt after worker crash without resending or creating a second attempt', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const deliveryIdentityKey = createHash('sha256')
      .update(`m9-submission-boundary|${scope}`, 'utf8')
      .digest('hex');
    const commandIdentityKey = createHash('sha256')
      .update(`m9-submission-boundary-command|${scope}`, 'utf8')
      .digest('hex');
    const providerIdempotencyKey = `m9-submission-provider-${scope}`;

    const doctor = await prisma.user.create({
      data: {
        email: `m9-submission-${scope}@example.test`,
        firstName: 'Submission',
        lastName: 'Boundary',
        mobileNumber: `+63920${scope.slice(0, 7)}`,
        passwordHash: 'm9-submission-e2e-fixture-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });

    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m9-submission-${scope}`,
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

    await expect(
      submissionBoundary.reserveAttempt(outbox.id, submissionWorkerId, now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 1 });

    const reservedOutbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(reservedOutbox.attemptCount).toBe(1);
    await expect(
      prisma.notificationLog.count({
        where: { notificationOutboxId: outbox.id },
      }),
    ).resolves.toBe(0);

    await prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        processingStartedAt: new Date('1900-01-01T00:00:00.000Z'),
        leaseExpiresAt: new Date('1900-01-01T00:01:00.000Z'),
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
    expect(candidate?.latestAttemptNumber).toBeNull();

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
    expect(finalOutbox.processingWorkerId).toBeNull();
    expect(finalOutbox.leaseExpiresAt).toBeNull();

    const logs = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].attemptNumber).toBe(1);
    expect(logs[0].outcome).toBe(NotificationAttemptOutcome.SUCCESS);
    expect(logs[0].providerStatus).toBe('reconciled-confirmed-success');
    expect(logs[0].providerIdempotencyKeyUsed).toBe(providerIdempotencyKey);
  }, 30_000);
});
