import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 Secretary password-reset parity (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-reset-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 31).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 32).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-reset-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-reset-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 33).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-reset-otp-hmac-v1',
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

  async function currentResetToken(userId: string) {
    const reset = await prisma.passwordReset.findFirstOrThrow({
      where: { userId, status: 'PENDING' },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedMessage = reset.notificationOutbox?.messageBodyEncrypted;
    if (!encryptedMessage) throw new Error('Password reset message missing.');
    const message = protectedPayloadService.decrypt(
      encryptedMessage,
      'password-reset:message',
    );
    const url = message.match(/https:\/\/\S+/)?.[0];
    const token = url ? new URL(url).searchParams.get('token') : null;
    if (!token) throw new Error('Password reset token missing.');
    return token;
  }

  it('resets an ACTIVE Secretary password, revokes all sessions, and preserves zero clinic authority', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-reset-${unique}@example.test`;
    const oldPassword = 'R1-Secretary-Old-Password-42!';
    const newPassword = 'R1-Secretary-New-Password-84!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Reset',
        lastName: 'Secretary',
        mobileNumber: '+639171234567',
        passwordHash: await bcrypt.hash(oldPassword, 12),
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const browserA = request.agent(app.getHttpServer());
    const browserB = request.agent(app.getHttpServer());
    await browserA
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(201);
    await browserB
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(201);
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email })
      .expect(201, { accepted: true });
    const token = await currentResetToken(user.id);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword })
      .expect(201, { reset: true });

    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    await browserA.get('/auth/profile').expect(401);
    await browserB.get('/auth/profile').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);

    const freshBrowser = request.agent(app.getHttpServer());
    await freshBrowser
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(201);
    const profile = await freshBrowser.get('/auth/profile').expect(200);
    expect(profile.body).toEqual({ userId: user.id, role: 'SECRETARY' });
    const workspace = await freshBrowser
      .get('/secretary/workspace')
      .expect(200);
    expect(workspace.body).toEqual({ clinics: [], invitations: [] });
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it('allows a VOLUNTARILY_DISABLED Secretary to reset credentials without reactivating the account', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-disabled-reset-${unique}@example.test`;
    const oldPassword = 'R1-Disabled-Secretary-Old-42!';
    const newPassword = 'R1-Disabled-Secretary-New-84!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Disabled',
        lastName: 'Secretary',
        mobileNumber: '+639181234567',
        passwordHash: await bcrypt.hash(oldPassword, 12),
        role: 'SECRETARY',
        accountStatus: 'VOLUNTARILY_DISABLED',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email })
      .expect(201, { accepted: true });
    const token = await currentResetToken(user.id);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword })
      .expect(201, { reset: true });

    const afterReset = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(afterReset.accountStatus).toBe('VOLUNTARILY_DISABLED');
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(401);

    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', `reactivate-${unique}`)
      .send({ email, password: newPassword })
      .expect(201, { reactivated: true, replayed: false });

    const reactivated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(reactivated.accountStatus).toBe('ACTIVE');
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });
});
