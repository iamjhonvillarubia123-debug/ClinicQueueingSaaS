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
import { NotificationDeliveryWorkerService } from './../src/notification/notification-delivery-worker.service';
import { NotificationOutboxClaimService } from './../src/notification/notification-outbox-claim.service';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { NotificationProviderAdapter } from './../src/notification/notification-provider-adapter';
import { PrismaService } from './../src/prisma/prisma.service';
import { MobileNumberService } from './../src/security/mobile-number/mobile-number.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Notification delivery worker orchestration controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let claimService: NotificationOutboxClaimService;
  let workerService: NotificationDeliveryWorkerService;
  let payloadService: NotificationPayloadService;
  let mobileNumberService: MobileNumberService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9s4-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 121).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 122).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9s4-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9s4-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 123).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9s4-otp-hmac-v1',
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
    workerService = moduleFixture.get(NotificationDeliveryWorkerService);
    payloadService = moduleFixture.get(NotificationPayloadService);
    mobileNumberService = moduleFixture.get(MobileNumberService);
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

  it('delivers a claimed encrypted SMS through the adapter and persists provider success', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const deliveryIdentityKey = createHash('sha256')
      .update(`m9s4|${scope}`, 'utf8')
      .digest('hex');
    const commandIdentityKey = createHash('sha256')
      .update(`m9s4-command|${scope}`, 'utf8')
      .digest('hex');
    const providerIdempotencyKey = `m9s4-provider-${scope}`;
    const numericSuffix = Array.from(scope.slice(0, 7), (character) =>
      (Number.parseInt(character, 16) % 10).toString(),
    ).join('');
    const mobile = `+63920${numericSuffix}`;
    const canonicalMobile = mobileNumberService.normalize(mobile).canonical;
    const protectedMobile = mobileNumberService.protect(mobile);
    const messageBody = `M9S4 delivery ${scope.slice(0, 8)}`;

    const doctor = await prisma.user.create({
      data: {
        email: `m9s4-${scope}@example.test`,
        firstName: 'M9S4',
        lastName: 'Doctor',
        mobileNumber: mobile,
        passwordHash: 'm9s4-e2e-fixture-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });

    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m9s4-${scope}`,
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
        recipientMobileEncrypted: protectedMobile.encrypted,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: payloadService.encryptMessage(messageBody),
        providerIdempotencyKey,
        attemptCount: 0,
        nextAttemptAt: new Date(0),
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    const workerId = `worker-${scope.slice(0, 8)}`;
    const claimed = await claimService.claimNext(workerId, 60_000, now);
    expect(claimed?.id).toBe(outbox.id);

    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() =>
      Promise.resolve({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: `provider-ref-${scope}`,
        providerStatus: 'accepted',
        submittedAt: now,
        resolvedAt: now,
      }),
    );

    const adapter: NotificationProviderAdapter = {
      providerName: 'provider-a',
      channel: NotificationChannel.SMS,
      supportsIdempotency: true,
      supportsStatusLookup: true,
      submit,
      reconcile: jest.fn(),
    };

    const result = await workerService.deliverClaimed(claimed!, adapter, now);

    expect(result.outboxStatus).toBe(NotificationOutboxStatus.SENT);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      notificationOutboxId: outbox.id,
      notificationType: NotificationType.SECURITY_NOTIFICATION,
      channel: NotificationChannel.SMS,
      providerIdempotencyKey,
      recipient: canonicalMobile,
      messageBody,
    });

    const finalOutbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(finalOutbox.status).toBe(NotificationOutboxStatus.SENT);
    expect(finalOutbox.attemptCount).toBe(1);
    expect(finalOutbox.processingStartedAt).toBeNull();
    expect(finalOutbox.leaseExpiresAt).toBeNull();
    expect(finalOutbox.processingWorkerId).toBeNull();

    const logs = await prisma.notificationLog.findMany({
      where: { notificationOutboxId: outbox.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].attemptNumber).toBe(1);
    expect(logs[0].outcome).toBe(NotificationAttemptOutcome.SUCCESS);
    expect(logs[0].providerIdempotencyKeyUsed).toBe(providerIdempotencyKey);
    expect(logs[0].providerReference).toBe(`provider-ref-${scope}`);
  }, 30_000);
});
