import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { NotificationOutboxClaimService } from './../src/notification/notification-outbox-claim.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('NotificationOutbox claim concurrency controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let claimService: NotificationOutboxClaimService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9s1-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 91).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 92).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9s1-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9s1-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 93).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9s1-otp-hmac-v1',
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

  it('lets only one worker claim one due outbox', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const outbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey: scope,
        notificationType: NotificationType.SECURITY_NOTIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PENDING,
        recipientMobileEncrypted: `enc-${scope}`,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: `message-${scope}`,
        providerIdempotencyKey: `m9s1-${scope}`,
        attemptCount: 0,
        nextAttemptAt: new Date(now.getTime() - 1_000),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });

    const [workerA, workerB] = await Promise.all([
      claimService.claimNext(`worker-a-${scope.slice(0, 8)}`, 60_000, now),
      claimService.claimNext(`worker-b-${scope.slice(0, 8)}`, 60_000, now),
    ]);

    const claimed = [workerA, workerB].filter(
      (value): value is NonNullable<typeof value> => value !== null,
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(outbox.id);

    const stored = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(stored.status).toBe(NotificationOutboxStatus.PROCESSING);
    expect(stored.processingWorkerId).toBe(claimed[0].processingWorkerId);
    expect(stored.processingStartedAt?.getTime()).toBe(now.getTime());
    expect(stored.leaseExpiresAt?.getTime()).toBe(now.getTime() + 60_000);
  }, 30_000);
});
