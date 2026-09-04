import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 Secretary disable and reactivation controls (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-disable-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-disable-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-disable-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 23).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-disable-otp-hmac-v1',
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

  it('requires the current password, revokes the session, and reactivates without restoring authority or creating a session', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-disable-${unique}@example.test`;
    const password = 'R1-Secretary-Disable-42!';
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Maria',
        lastName: 'Secretary',
        mobileNumber: '+639171234567',
        passwordHash: await bcrypt.hash(password, 12),
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);

    const browser = request.agent(app.getHttpServer());
    await browser.post('/auth/login').send({ email, password }).expect(201);

    await browser
      .post('/secretary/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `disable-missing-${unique}`)
      .send({})
      .expect(400);

    await browser
      .post('/secretary/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `disable-wrong-${unique}`)
      .send({ currentPassword: 'wrong-password' })
      .expect(401);

    const activeUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(activeUser.accountStatus).toBe('ACTIVE');

    await browser
      .post('/secretary/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `disable-correct-${unique}`)
      .send({ currentPassword: password })
      .expect(201)
      .expect({ disabled: true, replayed: false });

    const disabledUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(disabledUser.accountStatus).toBe('VOLUNTARILY_DISABLED');
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);
    await browser.get('/auth/profile').expect(401);

    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', `reactivate-wrong-${unique}`)
      .send({ email, password: 'wrong-password' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', `reactivate-correct-${unique}`)
      .send({ email, password })
      .expect(201)
      .expect({ reactivated: true, replayed: false });

    const reactivatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(reactivatedUser.accountStatus).toBe('ACTIVE');
    expect(
      await prisma.userSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);

    await request(app.getHttpServer()).get('/secretary/workspace').expect(401);

    const newBrowser = request.agent(app.getHttpServer());
    await newBrowser.post('/auth/login').send({ email, password }).expect(201);
    const workspace = await newBrowser.get('/secretary/workspace').expect(200);
    expect(workspace.body).toEqual({ clinics: [], invitations: [] });
    expect(
      await prisma.practiceStaff.count({ where: { userId: user.id } }),
    ).toBe(0);
  });
});
