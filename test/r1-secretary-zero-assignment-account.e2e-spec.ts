import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 Secretary zero-assignment account journey (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 11).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 12).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 13).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
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

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('self-registers, verifies, signs in, and opens an empty Secretary workspace without clinic authority', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-r1-${unique}@example.test`;
    const password = 'R1-Secretary-Password-42!';

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Maria',
        lastName: 'Secretary',
        email,
        mobileNumber: '09171234567',
        password,
        role: 'SECRETARY',
      })
      .expect(201);
    const registrationBody = registration.body as unknown as {
      userId: string;
      role: 'SECRETARY';
      emailVerificationRequired: boolean;
    };
    const userId = registrationBody.userId;

    expect(registrationBody).toEqual(
      expect.objectContaining({
        userId,
        role: 'SECRETARY',
        emailVerificationRequired: true,
      }),
    );

    expect(await prisma.practiceStaff.count({ where: { userId } })).toBe(0);
    expect(await prisma.doctorProfile.count({ where: { userId } })).toBe(0);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);

    const verification = await prisma.emailVerification.findFirstOrThrow({
      where: { userId, status: 'PENDING' },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedMessage =
      verification.notificationOutbox?.messageBodyEncrypted;
    if (!encryptedMessage) throw new Error('Verification message is missing.');

    const message = protectedPayloadService.decrypt(
      encryptedMessage,
      'doctor-email-verification:message',
    );
    const verificationUrl = message.match(/https:\/\/\S+/)?.[0];
    const token = verificationUrl
      ? new URL(verificationUrl).searchParams.get('token')
      : null;
    if (!token) throw new Error('Verification token is missing.');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(201);

    const browser = request.agent(app.getHttpServer());
    await browser.post('/auth/login').send({ email, password }).expect(201);

    const profile = await browser.get('/auth/profile').expect(200);
    expect(profile.body).toEqual({ userId, role: 'SECRETARY' });

    const workspace = await browser.get('/secretary/workspace').expect(200);
    expect(workspace.body).toEqual({ clinics: [], invitations: [] });

    expect(await prisma.practiceStaff.count({ where: { userId } })).toBe(0);
  });
});
