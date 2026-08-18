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
import { NotificationOutboxClaimService } from './../src/notification/notification-outbox-claim.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Notification delivery attempt persistence controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let claimService: NotificationOutboxClaimService;
  let attemptService: NotificationDeliveryAttemptService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9s2-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 101).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 102).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9s2-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9s2-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 103).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9s2-otp-hmac-v1',
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
    claimService = moduleFixture.get(NotificationOutboxClaimService);
    attemptService = moduleFixture.get(NotificationDeliveryAttemptService);
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

  it('appends attempt history and reuses the same provider idempotency key across retry then success', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const deliveryIdentityKey = createHash('sha256')
      .update(`m9s2|${scope}`, 'utf8')
      .digest('hex');
    const commandIdentityKey = createHash('sha256')
      .update(`m9s2-command|${scope}`, 'utf8')
      .digest('hex');
    const providerIdempotencyKey = `m9s2-provider-${scope}`;

    const doctor = await prisma.user.create({
      data: {
        email: `m9s2-${scope}@example.test`,
        firstName: 'M9S2',
        lastName: 'Doctor',
        mobileNumber: `+63918${scope.slice(0, 7)}`,
        passwordHash: 'm9s2-e2e-fixture-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });

    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m9s2-${scope}`,
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

    const outbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: NotificationType.SECURITY_NOTIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        commandIdempotencyId: command.id,
        recipientMobileEncrypted: `enc-${scope}`,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: `message-${scope}`,
        providerIdempotencyKey,
        attemptCount: 0,
        nextAttemptAt: new Date(now.getTime() - 1_000),
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    const workerId = `worker-${scope.slice(0, 8)}`;
    const firstClaim = await claimService.claimNext(workerId, 60_000, now);
    expect(firstClaim?.id).toBe(outbox.id);

    const retryAt = new Date(now.getTime() + 5 * 60_000);
    await attemptService.finalizeAttempt(
      outbox.id,
      workerId,
      {
        outcome: NotificationAttemptOutcome.RETRYABLE_FAILURE,
        providerName: 'provider-a',
        providerErrorCode: 'timeout',
        failureDetailSanitized: 'Provider timeout',
        submittedAt: new Date(now.getTime() - 500),
        resolvedAt: now,
        nextAttemptAt: retryAt,
      },
      now,
    );

    const afterRetry = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(afterRetry.status).toBe(NotificationOutboxStatus.PENDING);
    expect(afterRetry.attemptCount).toBe(1);
    expect(afterRetry.nextAttemptAt.getTime()).toBe(retryAt.getTime());

    const secondNow = new Date(retryAt.getTime() + 1_000);
    const secondClaim = await claimService.claimNext(
      workerId,
      60_000,
      secondNow,
    );
    expect(secondClaim?.id).toBe(outbox.id);

    await attemptService.finalizeAttempt(
      outbox.id,
      workerId,
      {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: 'provider-message-1',
        providerStatus: 'accepted',
        submittedAt: secondNow,
        resolvedAt: secondNow,
      },
      secondNow,
    );

    const finalOutbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(finalOutbox.status).toBe(NotificationOutboxStatus.SENT);
    expect(finalOutbox.attemptCount).toBe(2);
    expect(finalOutbox.sentAt?.getTime()).toBe(secondNow.getTime());

    const logs = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
      orderBy: { attemptNumber: 'asc' },
    });

    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.attemptNumber)).toEqual([1, 2]);
    expect(logs.map((log) => log.outcome)).toEqual([
      NotificationAttemptOutcome.RETRYABLE_FAILURE,
      NotificationAttemptOutcome.SUCCESS,
    ]);
    expect(logs.map((log) => log.providerIdempotencyKeyUsed)).toEqual([
      providerIdempotencyKey,
      providerIdempotencyKey,
    ]);
    expect(logs[0].retryRecommended).toBe(true);
    expect(logs[1].retryRecommended).toBe(false);
  }, 30_000);
});
