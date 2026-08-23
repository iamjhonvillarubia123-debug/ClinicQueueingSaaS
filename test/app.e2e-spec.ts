import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PasswordResetMaintenanceService } from './../src/auth/password-reset-maintenance.service';
import { ProtectedAccountPayloadService } from './../src/auth/security/protected-account-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;
  let passwordResetMaintenanceService: PasswordResetMaintenanceService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm1s1-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 3).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
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
    passwordResetMaintenanceService = moduleFixture.get(
      PasswordResetMaintenanceService,
    );

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

    expect(response.body).toEqual({
      status: 'OK',
    });
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

  it('supports multiple sessions, bounded idle renewal, and idempotent server-side logout', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `session-${unique}@example.test`;
    const password = 'M2Slice2C-Session-Password-42!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Session',
        lastName: 'Doctor',
        mobileNumber: '+639171234567',
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const firstBrowser = request.agent(app.getHttpServer());
    const secondBrowser = request.agent(app.getHttpServer());

    const firstLogin = await firstBrowser
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect(firstLogin.body).not.toHaveProperty('sessionToken');
    const firstCookie = firstLogin.headers['set-cookie']?.[0];
    expect(firstCookie).toContain('HttpOnly');
    expect(firstCookie).toContain('SameSite=Lax');
    expect(firstCookie).toContain('Path=/');

    const firstSession = await prisma.userSession.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    await secondBrowser
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(
      2,
    );

    const absoluteExpiry = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.userSession.update({
      where: { id: firstSession.id },
      data: {
        lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        expiresAt: absoluteExpiry,
      },
    });

    await firstBrowser.get('/auth/profile').expect(200);
    const renewed = await prisma.userSession.findUniqueOrThrow({
      where: { id: firstSession.id },
    });
    expect(renewed.idleExpiresAt.getTime()).toBe(absoluteExpiry.getTime());
    expect(renewed.expiresAt.getTime()).toBe(absoluteExpiry.getTime());

    const activeSessions = await prisma.userSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    const secondSession = activeSessions.find(
      (item) => item.id !== firstSession.id,
    );
    if (!secondSession) throw new Error('Second session was not created.');

    const logout = await firstBrowser
      .post('/auth/logout')
      .set('Origin', 'https://app.example.test')
      .expect(201);
    expect(logout.body).toEqual({ loggedOut: true });
    expect(logout.headers['set-cookie']?.[0]).toContain('clinic_session=;');

    const firstAfterLogout = await prisma.userSession.findUniqueOrThrow({
      where: { id: firstSession.id },
    });
    const secondAfterLogout = await prisma.userSession.findUniqueOrThrow({
      where: { id: secondSession.id },
    });
    expect(firstAfterLogout.revokedAt).not.toBeNull();
    expect(secondAfterLogout.revokedAt).toBeNull();

    await firstBrowser.get('/auth/profile').expect(401);
    await secondBrowser.get('/auth/profile').expect(200);

    await firstBrowser
      .post('/auth/logout')
      .set('Origin', 'https://app.example.test')
      .expect(201, { loggedOut: true });
  });

  it('serializes password-reset replacement and consumes one reset exactly once while revoking all sessions', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `reset-${unique}@example.test`;
    const oldPassword = 'M2Slice2D-Old-Password-42!';
    const newPassword = 'M2Slice2D-New-Password-84!';
    const emailVerifiedAt = new Date();
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Reset',
        lastName: 'Doctor',
        mobileNumber: `+63917${unique.replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(oldPassword, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt,
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

    const missingResponse = await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: `missing-${unique}@example.test` })
      .expect(201);
    const concurrentResponses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email }),
      request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email }),
    ]);
    expect(missingResponse.body).toEqual({ accepted: true });
    expect(concurrentResponses.map((response) => response.status)).toEqual([
      201, 201,
    ]);
    expect(concurrentResponses[0].body).toEqual({ accepted: true });
    expect(concurrentResponses[1].body).toEqual({ accepted: true });

    const resets = await prisma.passwordReset.findMany({
      where: { userId: user.id },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'asc' },
    });
    const pending = resets.filter((item) => item.status === 'PENDING');
    expect(pending).toHaveLength(1);
    expect(
      resets.filter((item) => item.status === 'REVOKED').length,
    ).toBeGreaterThanOrEqual(1);
    expect(pending[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pending[0].activeResetKey).toMatch(/^[0-9a-f]{64}$/);
    expect(
      pending[0].expiresAt.getTime() - pending[0].createdAt.getTime(),
    ).toBe(30 * 60 * 1000);
    expect(pending[0].notificationOutbox?.notificationType).toBe(
      'PASSWORD_RESET',
    );
    expect(pending[0].notificationOutbox?.channel).toBe('EMAIL');
    expect(pending[0].notificationOutbox?.practiceLocationId).toBeNull();
    expect(pending[0].notificationOutbox?.recipientMobileEncrypted).toBeNull();

    const revokedWithMessage = resets.find(
      (item) =>
        item.status === 'REVOKED' &&
        item.notificationOutbox?.messageBodyEncrypted,
    );
    if (!revokedWithMessage?.notificationOutbox?.messageBodyEncrypted) {
      throw new Error('Revoked password reset message missing.');
    }
    const revokedMessage = protectedPayloadService.decrypt(
      revokedWithMessage.notificationOutbox.messageBodyEncrypted,
      'password-reset:message',
    );
    const revokedUrl = revokedMessage.match(/https:\/\/\S+/)?.[0];
    const revokedToken = revokedUrl
      ? new URL(revokedUrl).searchParams.get('token')
      : null;
    if (!revokedToken) throw new Error('Revoked password reset token missing.');
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: revokedToken, newPassword })
      .expect(400);

    const encryptedMessage =
      pending[0].notificationOutbox?.messageBodyEncrypted;
    if (!encryptedMessage) throw new Error('Password reset message missing.');
    const message = protectedPayloadService.decrypt(
      encryptedMessage,
      'password-reset:message',
    );
    const matchedUrl = message.match(/https:\/\/\S+/)?.[0];
    if (!matchedUrl) throw new Error('Password reset URL missing.');
    const token = new URL(matchedUrl).searchParams.get('token');
    if (!token) throw new Error('Password reset token missing.');

    const consumeResponses = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword }),
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword }),
    ]);
    expect(consumeResponses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);

    const consumed = await prisma.passwordReset.findUniqueOrThrow({
      where: { id: pending[0].id },
    });
    const resetUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(consumed.status).toBe('CONSUMED');
    expect(consumed.tokenHash).toBeNull();
    expect(consumed.activeResetKey).toBeNull();
    expect(resetUser.emailVerifiedAt?.getTime()).toBe(
      emailVerifiedAt.getTime(),
    );
    expect(resetUser.accountStatus).toBe('ACTIVE');
    expect(resetUser.administrativeRestrictionStatus).toBe('NONE');
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
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(201);
  });

  it('allows credential reset for a voluntarily disabled account without reactivating it', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `disabled-reset-${unique}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Disabled',
        lastName: 'Doctor',
        mobileNumber: `+63917${unique.replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`,
        passwordHash: await bcrypt.hash('Old disabled password', 12),
        role: 'DOCTOR',
        accountStatus: 'VOLUNTARILY_DISABLED',
        administrativeRestrictionStatus: 'SUSPENDED',
        emailVerifiedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email })
      .expect(201, { accepted: true });

    const reset = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: user.id, status: 'PENDING' },
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

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, newPassword: 'New disabled password' })
      .expect(201, { reset: true });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.accountStatus).toBe('VOLUNTARILY_DISABLED');
    expect(after.administrativeRestrictionStatus).toBe('SUSPENDED');
    expect(after.emailVerifiedAt?.getTime()).toBe(
      user.emailVerifiedAt?.getTime(),
    );
  });

  it('expires stale password resets, cancels stale delivery, and deletes only relation-free terminal reset rows', async () => {
    const unique = randomUUID();
    const email = `reset-maintenance-${unique}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Maintenance',
        lastName: 'Doctor',
        mobileNumber: `+63919${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash('Maintenance password 42!', 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const expiredAt = new Date(Date.now() - 60_000);
    const createdAt = new Date(expiredAt.getTime() - 30 * 60 * 1000);
    const stale = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: 'a'.repeat(64),
        activeResetKey: ('b' + unique.replace(/-/g, ''))
          .padEnd(64, 'b')
          .slice(0, 64),
        status: 'PENDING',
        createdAt,
        expiresAt: expiredAt,
      },
    });
    const staleOutbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey: `c${unique.replace(/-/g, '').slice(0, 63)}`.padEnd(
          64,
          'c',
        ),
        notificationType: 'PASSWORD_RESET',
        channel: 'EMAIL',
        status: 'PENDING',
        passwordResetId: stale.id,
        recipientEmailEncrypted: protectedPayloadService.encrypt(
          email,
          'password-reset:recipient',
        ),
        messageBodyEncrypted: protectedPayloadService.encrypt(
          'stale reset',
          'password-reset:message',
        ),
        providerIdempotencyKey: `maintenance:${stale.id}`,
        createdAt,
        nextAttemptAt: createdAt,
        expiresAt: expiredAt,
      },
    });

    await expect(
      passwordResetMaintenanceService.expirePendingBatch(20),
    ).resolves.toBeGreaterThanOrEqual(1);
    const expiredReset = await prisma.passwordReset.findUniqueOrThrow({
      where: { id: stale.id },
    });
    const cancelledOutbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: staleOutbox.id },
    });
    expect(expiredReset.status).toBe('EXPIRED');
    expect(expiredReset.tokenHash).toBeNull();
    expect(expiredReset.activeResetKey).toBeNull();
    expect(cancelledOutbox.status).toBe('CANCELLED');

    const consumed = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: null,
        activeResetKey: null,
        status: 'CONSUMED',
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
      },
    });
    const consumedOutbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey: `d${unique.replace(/-/g, '').slice(0, 63)}`.padEnd(
          64,
          'd',
        ),
        notificationType: 'PASSWORD_RESET',
        channel: 'EMAIL',
        status: 'PENDING',
        passwordResetId: consumed.id,
        recipientEmailEncrypted: protectedPayloadService.encrypt(
          email,
          'password-reset:recipient',
        ),
        messageBodyEncrypted: protectedPayloadService.encrypt(
          'consumed reset',
          'password-reset:message',
        ),
        providerIdempotencyKey: `maintenance:${consumed.id}`,
        nextAttemptAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      passwordResetMaintenanceService.revalidateOutboxForSend(
        consumedOutbox.id,
      ),
    ).resolves.toBe(false);
    expect(
      (
        await prisma.notificationOutbox.findUniqueOrThrow({
          where: { id: consumedOutbox.id },
        })
      ).status,
    ).toBe('CANCELLED');

    const oldTerminalExpiresAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const oldTerminalCreatedAt = new Date(
      oldTerminalExpiresAt.getTime() - 30 * 60 * 1000,
    );
    const oldTerminal = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        status: 'EXPIRED',
        tokenHash: null,
        activeResetKey: null,
        createdAt: oldTerminalCreatedAt,
        expiresAt: oldTerminalExpiresAt,
      },
    });

    await expect(
      passwordResetMaintenanceService.deleteEligibleTerminalBatch(20),
    ).resolves.toBeGreaterThanOrEqual(1);
    expect(
      await prisma.passwordReset.findUnique({ where: { id: oldTerminal.id } }),
    ).toBeNull();
  });

  it('disables a Doctor, revokes the live session, and requires fresh login after pre-login reactivation', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `doctor-lifecycle-${unique}@example.test`;
    const password = 'Doctor lifecycle password 42!';

    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Lifecycle',
        lastName: 'Doctor',
        mobileNumber: `+63920${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const browser = request.agent(app.getHttpServer());
    await browser.post('/auth/login').send({ email, password }).expect(201);
    await browser.get('/auth/profile').expect(200);

    const disableKey = `disable-${unique}`;
    await browser
      .post('/doctor/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', disableKey)
      .send({ password })
      .expect(201, { disabled: true, replayed: false });

    const disabled = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(disabled.accountStatus).toBe('VOLUNTARILY_DISABLED');
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    await browser.get('/auth/profile').expect(401);

    await browser
      .post('/doctor/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', disableKey)
      .expect(401);

    const reactivateKey = `reactivate-${unique}`;
    await request(app.getHttpServer())
      .post('/doctor/account/reactivate')
      .set('Idempotency-Key', reactivateKey)
      .send({ email, password })
      .expect(201, { reactivated: true, replayed: false });

    const reactivated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(reactivated.accountStatus).toBe('ACTIVE');
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post('/doctor/account/reactivate')
      .set('Idempotency-Key', reactivateKey)
      .send({ email, password })
      .expect(201, { reactivated: true, replayed: true });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        accountStatus: 'VOLUNTARILY_DISABLED',
        administrativeRestrictionStatus: 'SUSPENDED',
      },
    });
    await prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await request(app.getHttpServer())
      .post('/doctor/account/reactivate')
      .set('Idempotency-Key', `restricted-${unique}`)
      .send({ email, password })
      .expect(409);

    const stillRestricted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stillRestricted.accountStatus).toBe('VOLUNTARILY_DISABLED');
    expect(stillRestricted.administrativeRestrictionStatus).toBe('SUSPENDED');
  });

  it('permanently closes a Doctor exactly once and allows only a new User identity to return', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `doctor-delete-${unique}@example.test`;
    const password = 'Doctor permanent delete password 42!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Permanent',
        lastName: 'Closure',
        mobileNumber: `+63921${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        professionalTitle: 'Dr.',
        specialization: 'General Medicine',
        licenseNumber: `DEL-${unique}`,
        isProfilePublic: true,
      },
    });

    const browser = request.agent(app.getHttpServer());
    await browser.post('/auth/login').send({ email, password }).expect(201);
    await browser.get('/auth/profile').expect(200);

    const idempotencyKey = `delete-${unique}`;
    await request(app.getHttpServer())
      .post('/doctor/account/permanent-delete')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        email,
        password,
        confirmPermanentDelete: true,
      })
      .expect(201, {
        permanentlyClosed: true,
        replayed: false,
        publicRouteRetired: true,
      })
      .expect(201);

    const closedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(closedUser.accountStatus).toBe('PERMANENTLY_CLOSED');
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    await browser.get('/auth/profile').expect(401);

    const auditRows = await prisma.accountPermanentClosureAudit.findMany({
      where: { accountUserId: user.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        initiatedByUserId: user.id,
        closureType: 'DOCTOR_PERMANENT_CLOSURE',
        previousAccountStatus: 'ACTIVE',
      }),
    );

    const commandRows = await prisma.commandIdempotency.findMany({
      where: {
        accountUserId: user.id,
        commandType: 'DOCTOR_DELETE_ACCOUNT',
      },
    });
    expect(commandRows).toHaveLength(1);

    const closureOutboxes = await prisma.notificationOutbox.findMany({
      where: {
        commandIdempotencyId: commandRows[0].id,
        notificationType: 'SECURITY_NOTIFICATION',
        channel: 'EMAIL',
      },
    });
    expect(closureOutboxes).toHaveLength(1);

    await request(app.getHttpServer())
      .post('/doctor/account/permanent-delete')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        email,
        password,
        confirmPermanentDelete: true,
      })
      .expect(201, {
        permanentlyClosed: true,
        replayed: true,
        publicRouteRetired: true,
      })
      .expect(201);

    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: user.id },
      }),
    ).toBe(1);
    expect(
      await prisma.commandIdempotency.count({
        where: {
          accountUserId: user.id,
          commandType: 'DOCTOR_DELETE_ACCOUNT',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notificationOutbox.count({
        where: {
          commandIdempotencyId: commandRows[0].id,
          notificationType: 'SECURITY_NOTIFICATION',
          channel: 'EMAIL',
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/doctor/account/reactivate')
      .set('Idempotency-Key', `reactivate-closed-${unique}`)
      .send({ email, password })
      .expect(401);

    const registration = await request(app.getHttpServer())
      .post('/doctor/register')
      .send({
        firstName: 'Returned',
        lastName: 'Doctor',
        email,
        mobileNumber: `+63917${unique.replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`,
        password: 'Returned Doctor Password 42!',
        professionalTitle: 'Dr.',
        specialization: 'General Medicine',
        licenseNumber: `RETURN-${unique}`,
      })
      .expect(201);

    const newUserId = (registration.body as { userId: string }).userId;
    expect(newUserId).not.toBe(user.id);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
        })
      ).accountStatus,
    ).toBe('PERMANENTLY_CLOSED');
    expect(
      (
        await prisma.doctorProfile.findUniqueOrThrow({
          where: { id: profile.id },
        })
      ).publicIdentifier,
    ).toBe(profile.publicIdentifier);
  });

  it('rejects Doctor Permanent Delete while an owned ClinicDay is STARTED without committing closure effects', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `doctor-delete-started-${unique}@example.test`;
    const password = 'Started clinic delete password 42!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Started',
        lastName: 'Clinic',
        mobileNumber: `+63923${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        professionalTitle: 'Dr.',
        specialization: 'General Medicine',
        licenseNumber: `START-${unique}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
      },
    });
    const startedAt = new Date();
    const clinicDay = await prisma.clinicDay.create({
      data: {
        practiceLocationId: location.id,
        serviceDate: new Date(
          Date.UTC(
            startedAt.getUTCFullYear(),
            startedAt.getUTCMonth(),
            startedAt.getUTCDate(),
          ),
        ),
        status: 'STARTED',
        startedAt,
        createdAt: startedAt,
      },
    });

    await request(app.getHttpServer())
      .post('/doctor/account/permanent-delete')
      .set('Idempotency-Key', `delete-started-${unique}`)
      .send({
        email,
        password,
        confirmPermanentDelete: true,
      })
      .expect(409);

    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
        })
      ).accountStatus,
    ).toBe('ACTIVE');
    expect(
      (
        await prisma.clinicDay.findUniqueOrThrow({
          where: { id: clinicDay.id },
        })
      ).status,
    ).toBe('STARTED');
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: user.id },
      }),
    ).toBe(0);
    expect(
      await prisma.commandIdempotency.count({
        where: {
          accountUserId: user.id,
          commandType: 'DOCTOR_DELETE_ACCOUNT',
        },
      }),
    ).toBe(0);
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
