import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 authentication role boundaries (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-role-boundary-e2e-only-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 41).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 42).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-role-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-role-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 43).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-role-otp-hmac-v1',
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

  it('keeps Doctor and Secretary protected workspaces isolated at the backend', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const doctorEmail = `doctor-role-${unique}@example.test`;
    const secretaryEmail = `secretary-role-${unique}@example.test`;
    const doctorPassword = 'R1-Doctor-Role-Password-42!';
    const secretaryPassword = 'R1-Secretary-Role-Password-42!';

    const doctor = await prisma.user.create({
      data: {
        email: doctorEmail,
        firstName: 'Role',
        lastName: 'Doctor',
        mobileNumber: '+639171111111',
        passwordHash: await bcrypt.hash(doctorPassword, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const secretary = await prisma.user.create({
      data: {
        email: secretaryEmail,
        firstName: 'Role',
        lastName: 'Secretary',
        mobileNumber: '+639172222222',
        passwordHash: await bcrypt.hash(secretaryPassword, 12),
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });

    const doctorBrowser = request.agent(app.getHttpServer());
    const secretaryBrowser = request.agent(app.getHttpServer());

    await doctorBrowser
      .post('/auth/login')
      .send({ email: doctorEmail, password: doctorPassword })
      .expect(201);
    await secretaryBrowser
      .post('/auth/login')
      .send({ email: secretaryEmail, password: secretaryPassword })
      .expect(201);

    await expect(doctorBrowser.get('/auth/profile')).resolves.toMatchObject({
      status: 200,
      body: { userId: doctor.id, role: 'DOCTOR' },
    });
    await expect(secretaryBrowser.get('/auth/profile')).resolves.toMatchObject({
      status: 200,
      body: { userId: secretary.id, role: 'SECRETARY' },
    });

    await doctorBrowser.get('/secretary/workspace').expect(403);

    await secretaryBrowser.get('/practice-location').expect(403);
    await secretaryBrowser
      .post('/practice-location')
      .set('Origin', 'https://app.example.test')
      .send({ name: 'Unauthorized Secretary Clinic' })
      .expect(403);

    expect(
      await prisma.practiceLocation.count({
        where: { name: 'Unauthorized Secretary Clinic' },
      }),
    ).toBe(0);
    expect(
      await prisma.practiceStaff.count({ where: { userId: secretary.id } }),
    ).toBe(0);
  });
});
