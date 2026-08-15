import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ProtectedAccountPayloadService } from './../src/auth/security/protected-account-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm1s1-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 3).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
  };

  const originalEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    protectedPayloadService = moduleFixture.get(ProtectedAccountPayloadService);

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

  it('/app/health (GET)', async () => {
    if (!app) {
      throw new Error('E2E application did not initialize.');
    }

    const response: Response = await request(app.getHttpServer())
      .get('/app/health')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'OK',
        message: 'Clinic Queueing SaaS API is running',
        userCount: expect.any(Number) as unknown,
      }),
    );
  });

  it('registers, verifies, and then permits ordinary Doctor login without auto-login on verification', async () => {
    if (!app) {
      throw new Error('E2E application did not initialize.');
    }

    const unique = randomUUID();
    const email = `doctor-${unique}@example.test`;
    const password = 'M2Slice2B-Test-Password-42!';

    const registration = await request(app.getHttpServer())
      .post('/doctor/register')
      .send({
        firstName: 'Jane',
        middleName: 'Q',
        lastName: 'Doe',
        email,
        mobileNumber: '09171234567',
        password,
        professionalTitle: 'Dr.',
        specialization: 'Family Medicine',
        licenseNumber: `LIC-${unique}`,
      })
      .expect(201);

    const registrationBody = registration.body as unknown as {
      userId: string;
      doctorProfileId: string;
      emailVerificationRequired: boolean;
      emailVerificationExpiresAt: string;
    };
    const userId = registrationBody.userId;
    expect(registrationBody).toEqual(
      expect.objectContaining({
        userId,
        doctorProfileId: expect.any(String) as unknown,
        emailVerificationRequired: true,
        emailVerificationExpiresAt: expect.any(String) as unknown,
      }),
    );
    expect(registrationBody).not.toHaveProperty('token');
    expect(registrationBody).not.toHaveProperty('passwordHash');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        doctorProfile: { include: { accountSettings: true } },
        emailVerifications: { include: { notificationOutbox: true } },
      },
    });

    expect(user).not.toBeNull();
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.doctorProfile?.accountSettings).not.toBeNull();
    expect(user?.emailVerifications).toHaveLength(1);

    const verification = user?.emailVerifications[0];
    expect(verification?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verification?.notificationOutbox?.practiceLocationId).toBeNull();
    expect(
      verification?.notificationOutbox?.recipientMobileEncrypted,
    ).toBeNull();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);

    expect(await prisma.userSession.count({ where: { userId } })).toBe(0);

    const encryptedMessage =
      verification?.notificationOutbox?.messageBodyEncrypted;
    if (!encryptedMessage) {
      throw new Error(
        'Verification outbox did not contain a protected message.',
      );
    }

    const message = protectedPayloadService.decrypt(
      encryptedMessage,
      'doctor-email-verification:message',
    );
    const matchedUrl = message.match(/https:\/\/\S+/)?.[0];
    if (!matchedUrl) {
      throw new Error('Verification message did not contain a URL.');
    }
    const token = new URL(matchedUrl).searchParams.get('token');
    if (!token) {
      throw new Error('Verification URL did not contain a token.');
    }

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(201, { verified: true });

    const verifiedUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    const verifiedRecord = await prisma.emailVerification.findUnique({
      where: { id: verification?.id },
    });

    expect(verifiedUser?.emailVerifiedAt).not.toBeNull();
    expect(verifiedRecord?.status).toBe('VERIFIED');
    expect(verifiedRecord?.verifiedAt?.getTime()).toBe(
      verifiedUser?.emailVerifiedAt?.getTime(),
    );
    expect(verifiedRecord?.tokenHash).toBeNull();
    expect(verifiedRecord?.activeVerificationKey).toBeNull();
    expect(await prisma.userSession.count({ where: { userId } })).toBe(0);

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(400);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(login.headers['set-cookie']).toBeDefined();
    expect(await prisma.userSession.count({ where: { userId } })).toBe(1);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }

    for (const key of Object.keys(testEnvironment)) {
      const originalValue = originalEnvironment[key];

      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });
});
