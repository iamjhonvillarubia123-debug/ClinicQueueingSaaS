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

    const concurrentVerificationResponses = await Promise.all([
      request(app.getHttpServer()).post('/auth/verify-email').send({ token }),
      request(app.getHttpServer()).post('/auth/verify-email').send({ token }),
    ]);
    expect(
      concurrentVerificationResponses.map((response) => response.status).sort(),
    ).toEqual([201, 400]);

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

  it('replaces verification generically and serializes concurrent resend to one pending credential', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `resend-${unique}@example.test`;
    const password = 'M2Slice2B-Resend-Password-42!';

    const registration = await request(app.getHttpServer())
      .post('/doctor/register')
      .send({
        firstName: 'Resend',
        lastName: 'Doctor',
        email,
        mobileNumber: '09181234567',
        password,
        professionalTitle: 'Dr.',
        specialization: 'General Practice',
        licenseNumber: `LIC-RESEND-${unique}`,
      })
      .expect(201);

    const registrationBody = registration.body as unknown as { userId: string };
    const userId = registrationBody.userId;
    const initial = await prisma.emailVerification.findFirstOrThrow({
      where: { userId, status: 'PENDING' },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedInitialMessage =
      initial.notificationOutbox?.messageBodyEncrypted;
    if (!encryptedInitialMessage)
      throw new Error('Initial verification message missing.');
    const initialMessage = protectedPayloadService.decrypt(
      encryptedInitialMessage,
      'doctor-email-verification:message',
    );
    const initialUrl = initialMessage.match(/https:\/\/\S+/)?.[0];
    const initialToken = initialUrl
      ? new URL(initialUrl).searchParams.get('token')
      : null;
    if (!initialToken) throw new Error('Initial verification token missing.');

    const genericMissing = await request(app.getHttpServer())
      .post('/auth/resend-email-verification')
      .send({ email: `missing-${unique}@example.test` })
      .expect(201);
    const genericExisting = await request(app.getHttpServer())
      .post('/auth/resend-email-verification')
      .send({ email })
      .expect(201);
    expect(genericMissing.body).toEqual({ accepted: true });
    expect(genericExisting.body).toEqual({ accepted: true });

    const revokedInitial = await prisma.emailVerification.findUniqueOrThrow({
      where: { id: initial.id },
      include: { notificationOutbox: true },
    });
    expect(revokedInitial.status).toBe('REVOKED');
    expect(revokedInitial.tokenHash).toBeNull();
    expect(revokedInitial.activeVerificationKey).toBeNull();
    expect(revokedInitial.notificationOutbox?.status).toBe('CANCELLED');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: initialToken })
      .expect(400);

    await Promise.all([
      request(app.getHttpServer())
        .post('/auth/resend-email-verification')
        .send({ email })
        .expect(201),
      request(app.getHttpServer())
        .post('/auth/resend-email-verification')
        .send({ email })
        .expect(201),
    ]);

    const verifications = await prisma.emailVerification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      verifications.filter((item) => item.status === 'PENDING'),
    ).toHaveLength(1);
    expect(verifications).toHaveLength(3);
  });

  it('creates a new Doctor identity when the same normalized email belongs only to a permanently closed historical User', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `returning-${unique}@example.test`;
    const oldUser = await prisma.user.create({
      data: {
        email,
        firstName: 'Historical',
        lastName: 'Doctor',
        mobileNumber: '+639171111111',
        passwordHash: 'historical-closed-hash',
        role: 'DOCTOR',
        accountStatus: 'PERMANENTLY_CLOSED',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const registration = await request(app.getHttpServer())
      .post('/doctor/register')
      .send({
        firstName: 'Returning',
        lastName: 'Doctor',
        email: email.toUpperCase(),
        mobileNumber: '09192222222',
        password: 'M2Slice2B-Returning-Password-42!',
        professionalTitle: 'Dr.',
        specialization: 'Family Medicine',
        licenseNumber: `LIC-RETURN-${unique}`,
      })
      .expect(201);

    const body = registration.body as unknown as { userId: string };
    expect(body.userId).not.toBe(oldUser.id);

    const oldAfter = await prisma.user.findUniqueOrThrow({
      where: { id: oldUser.id },
    });
    const newUser = await prisma.user.findUniqueOrThrow({
      where: { id: body.userId },
    });
    expect(oldAfter.accountStatus).toBe('PERMANENTLY_CLOSED');
    expect(newUser.email).toBe(email);
    expect(newUser.emailVerifiedAt).toBeNull();
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
