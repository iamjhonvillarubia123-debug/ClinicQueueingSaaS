import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 Secretary permanent account closure (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-permanent-closure-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-closure-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-closure-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 23).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-closure-otp-hmac-v1',
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

  it('requires irreversible confirmation and password, revokes access permanently, audits closure, and permits a fresh later identity', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-close-${unique}@example.test`;
    const password = 'R1-Secretary-Close-Password-42!';

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Maria',
        lastName: 'Closure',
        email,
        mobileNumber: '09171234567',
        password,
        role: 'SECRETARY',
      })
      .expect(201);

    const originalUserId = registration.body.userId as string;
    const verification = await prisma.emailVerification.findFirstOrThrow({
      where: { userId: originalUserId, status: 'PENDING' },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedMessage = verification.notificationOutbox?.messageBodyEncrypted;
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
    await browser
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    await browser.get('/auth/profile').expect(200);

    await request(app.getHttpServer())
      .post('/secretary/account/permanent-delete')
      .set('Idempotency-Key', `close-unconfirmed-${unique}`)
      .send({ email, password, confirmPermanentDelete: false })
      .expect(400);

    await request(app.getHttpServer())
      .post('/secretary/account/permanent-delete')
      .set('Idempotency-Key', `close-wrong-password-${unique}`)
      .send({
        email,
        password: 'Wrong-Password-42!',
        confirmPermanentDelete: true,
      })
      .expect(401);

    const beforeClosure = await prisma.user.findUniqueOrThrow({
      where: { id: originalUserId },
    });
    expect(beforeClosure.accountStatus).toBe('ACTIVE');

    const closure = await request(app.getHttpServer())
      .post('/secretary/account/permanent-delete')
      .set('Idempotency-Key', `close-${unique}`)
      .send({ email, password, confirmPermanentDelete: true })
      .expect(201);
    expect(closure.body).toEqual({ permanentlyClosed: true, replayed: false });

    const closedUser = await prisma.user.findUniqueOrThrow({
      where: { id: originalUserId },
    });
    expect(closedUser.accountStatus).toBe('PERMANENTLY_CLOSED');
    expect(
      await prisma.userSession.count({
        where: { userId: originalUserId, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: originalUserId },
      }),
    ).toBe(1);
    expect(
      await prisma.practiceStaff.count({
        where: { userId: originalUserId, isActive: true },
      }),
    ).toBe(0);

    await browser.get('/auth/profile').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', `reactivate-closed-${unique}`)
      .send({ email, password })
      .expect(401);

    const replay = await request(app.getHttpServer())
      .post('/secretary/account/permanent-delete')
      .set('Idempotency-Key', `close-${unique}`)
      .send({ email, password, confirmPermanentDelete: true })
      .expect(201);
    expect(replay.body).toEqual({ permanentlyClosed: true, replayed: true });
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: originalUserId },
      }),
    ).toBe(1);

    const replacementRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Maria',
        lastName: 'Returning',
        email: email.toUpperCase(),
        mobileNumber: '09181234567',
        password: 'R1-New-Secretary-Identity-42!',
        role: 'SECRETARY',
      })
      .expect(201);

    expect(replacementRegistration.body.userId).not.toBe(originalUserId);
    expect(replacementRegistration.body.role).toBe('SECRETARY');
    expect(
      await prisma.user.count({
        where: { email: email.toLowerCase() },
      }),
    ).toBe(2);
  });
});
