import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { NotificationPayloadService } from '../src/notification/notification-payload.service';

describe('Distributed rate limiting (e2e)', () => {
  let app: INestApplication<App> | undefined;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm13-rate-limit-e2e-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 141).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 142).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm13-rate-limit-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm13-rate-limit-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 143).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm13-rate-limit-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
    RATE_LIMIT_ENABLED: 'true',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const isolatedConfig = new ConfigService<Record<string, string>>({
      ...testEnvironment,
      DATABASE_URL: process.env.DATABASE_URL ?? '',
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(isolatedConfig)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each(['EMAIL', 'MOBILE'] as const)(
    'closes a newly registered %s Doctor on the first attempt despite an exhausted missing-identifier bucket',
    async (identifierType) => {
      if (!app) throw new Error('E2E application did not initialize.');
      const server = app.getHttpServer();
      const prisma = app.get(PrismaService);
      const identifier =
        identifierType === 'EMAIL'
          ? `doctor-first-close-${randomUUID()}@example.test`
          : `+63919${randomInt(1000000, 10000000)}`;
      const password = 'New-doctor-closure-regression-42!';

      // Reproduce the stale form's shared bucket without disabling rate limiting.
      for (let attempt = 0; attempt < 11; attempt += 1) {
        await request(server)
          .post('/doctor/account/permanent-delete')
          .set('Idempotency-Key', randomUUID())
          .send({
            email: 'stale-form@example.test',
            password,
            confirmPermanentDelete: true,
          });
      }
      await request(server)
        .post('/doctor/account/permanent-delete')
        .set('Idempotency-Key', randomUUID())
        .send({
          email: 'another-stale-form@example.test',
          password,
          confirmPermanentDelete: true,
        })
        .expect(429);

      const registration = await request(server)
        .post('/auth/register')
        .send({
          firstName: 'First',
          lastName: 'Closure',
          role: 'DOCTOR',
          identifier,
          password,
        })
        .expect(201);
      const userId = (registration.body as { userId: string }).userId;
      if (identifierType === 'EMAIL') {
        const challenge = await prisma.emailVerification.findFirstOrThrow({
          where: { userId, status: 'PENDING' },
          include: { notificationOutbox: true },
        });
        const encrypted = challenge.notificationOutbox?.messageBodyEncrypted;
        if (!encrypted)
          throw new Error('Missing test email verification message.');
        const message = app
          .get(ProtectedAccountPayloadService)
          .decrypt(encrypted, 'doctor-email-verification:message');
        const url = message.match(/https:\/\/\S+/)?.[0];
        const token = url ? new URL(url).searchParams.get('token') : null;
        if (!token) throw new Error('Missing test verification token.');
        await request(server)
          .post('/auth/verify-email')
          .send({ token })
          .expect(201);
      } else {
        const challenge = await prisma.otpVerification.findFirstOrThrow({
          where: { userId, purpose: 'ACCOUNT_MOBILE_VERIFICATION' },
          include: { notificationOutbox: true },
        });
        const encrypted = challenge.notificationOutbox?.messageBodyEncrypted;
        if (!encrypted)
          throw new Error('Missing test mobile verification message.');
        const otp = app
          .get(NotificationPayloadService)
          .decryptMessage(encrypted)
          .match(/\b\d{6}\b/)?.[0];
        if (!otp) throw new Error('Missing test verification code.');
        await request(server)
          .post('/auth/verify-mobile')
          .send({ userId, otp })
          .expect(201);
      }
      const browser = request.agent(server);
      await browser
        .post('/auth/login')
        .send({ identifier, password })
        .expect(201);
      await browser
        .post('/doctor/account/permanent-delete')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', randomUUID())
        .send({ identifier, password, confirmPermanentDelete: true })
        .expect(201)
        .expect({
          permanentlyClosed: true,
          replayed: false,
          publicRouteRetired: true,
        });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
          .accountStatus,
      ).toBe('PERMANENTLY_CLOSED');
      expect(
        await prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: userId },
        }),
      ).toBe(1);
      expect(
        await prisma.userSession.count({ where: { userId, revokedAt: null } }),
      ).toBe(0);
      await browser.get('/auth/profile').expect(401);
      await request(server)
        .post('/auth/login')
        .send({ identifier, password })
        .expect(401);
    },
  );

  it('limits Doctor closure by identifier and keeps separate accounts independent', async () => {
    if (!app) throw new Error('E2E application did not initialize.');
    const identifier = `closure-limit-${randomUUID()}@example.test`;
    const submit = (value: string) =>
      request(app!.getHttpServer())
        .post('/doctor/account/permanent-delete')
        .set('Idempotency-Key', randomUUID())
        .send({
          identifier: value,
          password: 'not-a-real-password',
          confirmPermanentDelete: true,
        });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await submit(identifier).expect(401);
    }
    const limited = await submit(identifier.toUpperCase()).expect(429);
    expect(
      (limited.body as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeGreaterThan(0);
    expect(
      (limited.body as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBe(Number(limited.headers['retry-after']));
    await submit(`other-${randomUUID()}@example.test`).expect(401);
  });

  it('rejects the eleventh matching login request within the 15-minute window', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const email = `rate-${randomUUID()}@example.test`;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: 'not-a-real-password' });

      expect(response.status).not.toBe(429);
    }

    const limited = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password: 'not-a-real-password' })
      .expect(429);
    const body = limited.body as unknown as {
      statusCode: number;
      code: string;
      message: string;
      requestId: string;
    };

    expect(limited.headers['retry-after']).toEqual(expect.any(String));
    expect(body.statusCode).toBe(429);
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.message).toBe('Too many requests. Please try again later.');
    expect(body.requestId).toEqual(expect.any(String));
  });
});
