import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PasswordResetStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Notification outbox transaction rollback (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9-outbox-rollback-e2e-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 31).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 32).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9-rollback-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9-rollback-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 33).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9-rollback-otp-v1',
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
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('rolls back notification intent and leaves no provider-attempt history when the business transaction fails', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const user = await prisma.user.create({
      data: {
        email: `m9-rollback-${scope}@example.test`,
        firstName: 'Rollback',
        lastName: 'Control',
        mobileNumber: `+63918${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
      },
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const reset = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        status: PasswordResetStatus.PENDING,
        tokenHash: createHash('sha256')
          .update(`rollback-token-${scope}`, 'utf8')
          .digest('hex'),
        activeResetKey: createHash('sha256')
          .update(`${NotificationType.PASSWORD_RESET}:${user.id}`, 'utf8')
          .digest('hex'),
        expiresAt,
      },
    });
    const deliveryIdentityKey = createHash('sha256')
      .update(`${NotificationType.PASSWORD_RESET}:${reset.id}:rollback`, 'utf8')
      .digest('hex');

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.notificationOutbox.create({
          data: {
            deliveryIdentityKey,
            notificationType: NotificationType.PASSWORD_RESET,
            channel: NotificationChannel.EMAIL,
            status: NotificationOutboxStatus.PENDING,
            practiceLocationId: null,
            passwordResetId: reset.id,
            recipientMobileEncrypted: null,
            recipientEmailEncrypted: 'rollback-protected-recipient',
            messageBodyEncrypted: 'rollback-protected-message',
            providerIdempotencyKey: `password-reset-rollback:${reset.id}`,
            nextAttemptAt: now,
            expiresAt,
          },
        });

        throw new Error('forced business transaction rollback');
      }),
    ).rejects.toThrow('forced business transaction rollback');

    await expect(
      prisma.notificationOutbox.count({ where: { deliveryIdentityKey } }),
    ).resolves.toBe(0);
    await expect(
      prisma.notificationLog.count({
        where: { notificationOutbox: { deliveryIdentityKey } },
      }),
    ).resolves.toBe(0);
  });
});
