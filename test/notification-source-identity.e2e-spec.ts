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

describe('Notification source identity uniqueness (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm9-source-identity-e2e-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm9-source-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm9-source-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 23).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm9-source-otp-v1',
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

  it('allows one PasswordReset source identity and rejects the same logical delivery identity for another source row', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const user = await prisma.user.create({
      data: {
        email: `m9-source-${scope}@example.test`,
        firstName: 'Source',
        lastName: 'Identity',
        mobileNumber: `+63917${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
      },
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const firstReset = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        status: PasswordResetStatus.PENDING,
        tokenHash: createHash('sha256')
          .update(`token:${scope}:first`, 'utf8')
          .digest('hex'),
        activeResetKey: createHash('sha256')
          .update(`active:${scope}:first`, 'utf8')
          .digest('hex'),
        expiresAt,
      },
    });
    const secondReset = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        status: PasswordResetStatus.REVOKED,
        tokenHash: null,
        activeResetKey: null,
        revokedAt: now,
        expiresAt,
      },
    });
    const deliveryIdentityKey = createHash('sha256')
      .update(`${NotificationType.PASSWORD_RESET}:${firstReset.id}`, 'utf8')
      .digest('hex');

    const firstOutbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: NotificationType.PASSWORD_RESET,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        passwordResetId: firstReset.id,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: 'e2e-protected-recipient',
        messageBodyEncrypted: 'e2e-protected-message',
        providerIdempotencyKey: `password-reset:${firstReset.id}`,
        nextAttemptAt: now,
        expiresAt,
      },
    });

    expect(firstOutbox).toMatchObject({
      deliveryIdentityKey,
      notificationType: NotificationType.PASSWORD_RESET,
      channel: NotificationChannel.EMAIL,
      practiceLocationId: null,
      passwordResetId: firstReset.id,
      appointmentId: null,
      bookingGroupId: null,
      scheduledReminderId: null,
    });

    await expect(
      prisma.notificationOutbox.create({
        data: {
          deliveryIdentityKey,
          notificationType: NotificationType.PASSWORD_RESET,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: null,
          passwordResetId: secondReset.id,
          recipientMobileEncrypted: null,
          recipientEmailEncrypted: 'second-protected-recipient',
          messageBodyEncrypted: 'second-protected-message',
          providerIdempotencyKey: `password-reset:${secondReset.id}`,
          nextAttemptAt: now,
          expiresAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.notificationOutbox.count({ where: { deliveryIdentityKey } }),
    ).resolves.toBe(1);
  });
});
