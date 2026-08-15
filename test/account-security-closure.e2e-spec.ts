import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Account security closure (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm2s2i-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 11).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 12).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 13).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };

  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      if (!process.env[key]) process.env[key] = value;
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

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('enforces current Secretary eligibility and Doctor ownership through the HTTP boundary', async () => {
    const unique = randomUUID();
    const password = 'M2S2I closure password 42!';

    const doctor = await prisma.user.create({
      data: {
        email: `security-doctor-${unique}@example.test`,
        firstName: 'Security',
        lastName: 'Doctor',
        mobileNumber: `+63917${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `SEC-${unique}`,
          },
        },
      },
      include: { doctorProfile: true },
    });

    const otherDoctor = await prisma.user.create({
      data: {
        email: `security-other-${unique}@example.test`,
        firstName: 'Other',
        lastName: 'Doctor',
        mobileNumber: `+63918${unique.replace(/-/g, '').slice(0, 7)}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Internal Medicine',
            licenseNumber: `OTHER-${unique}`,
          },
        },
      },
      include: { doctorProfile: true },
    });

    if (!doctor.doctorProfile || !otherDoctor.doctorProfile) {
      throw new Error(
        'Doctor profiles were not created for the security test.',
      );
    }

    const ownLocation = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        name: 'Security Own Clinic',
        addressLine1: '1 Security Street',
        cityMunicipality: 'Manila',
        province: 'Metro Manila',
        contactNumber: '+63280000001',
      },
    });

    const otherLocation = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: otherDoctor.doctorProfile.id,
        name: 'Other Doctor Clinic',
        addressLine1: '2 Security Street',
        cityMunicipality: 'Manila',
        province: 'Metro Manila',
        contactNumber: '+63280000002',
      },
    });

    const createSecretary = (
      suffix: string,
      accountStatus: 'ACTIVE' | 'VOLUNTARILY_DISABLED' | 'PERMANENTLY_CLOSED',
    ) =>
      prisma.user.create({
        data: {
          email: `security-secretary-${suffix}-${unique}@example.test`,
          firstName: 'Security',
          lastName: `Secretary ${suffix}`,
          mobileNumber: `+63919${randomUUID().replace(/-/g, '').slice(0, 7)}`,
          passwordHash: 'not-used-by-this-test',
          role: 'SECRETARY',
          accountStatus,
          administrativeRestrictionStatus: 'NONE',
          emailVerifiedAt: new Date(),
        },
      });

    const [activeSecretary, disabledSecretary, closedSecretary] =
      await Promise.all([
        createSecretary('active', 'ACTIVE'),
        createSecretary('disabled', 'VOLUNTARILY_DISABLED'),
        createSecretary('closed', 'PERMANENTLY_CLOSED'),
      ]);

    const browser = request.agent(app.getHttpServer());
    await browser
      .post('/auth/login')
      .send({ email: doctor.email, password })
      .expect(201);

    await browser
      .post('/practice-staff/regular/assign')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `assign-active-${unique}`)
      .send({
        practiceLocationId: ownLocation.id,
        userId: activeSecretary.id,
      })
      .expect(201);

    await browser
      .post('/practice-staff/regular/replace')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `replace-disabled-${unique}`)
      .send({
        practiceLocationId: ownLocation.id,
        userId: disabledSecretary.id,
        password,
      })
      .expect(403);

    await browser
      .post('/practice-staff/regular/replace')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `replace-closed-${unique}`)
      .send({
        practiceLocationId: ownLocation.id,
        userId: closedSecretary.id,
        password,
      })
      .expect(403);

    await browser
      .post('/practice-staff/regular/assign')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `assign-cross-location-${unique}`)
      .send({
        practiceLocationId: otherLocation.id,
        userId: activeSecretary.id,
      })
      .expect(404);

    expect(
      await prisma.practiceStaff.count({
        where: {
          practiceLocationId: ownLocation.id,
          userId: activeSecretary.id,
          isActive: true,
        },
      }),
    ).toBe(1);

    const ownLocationAuthority = await prisma.practiceLocation.findUnique({
      where: { id: ownLocation.id },
      select: { currentRegularPracticeStaffId: true },
    });
    expect(typeof ownLocationAuthority?.currentRegularPracticeStaffId).toBe(
      'string',
    );

    expect(
      await prisma.practiceStaff.count({
        where: {
          userId: { in: [disabledSecretary.id, closedSecretary.id] },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.practiceStaff.count({
        where: { practiceLocationId: otherLocation.id },
      }),
    ).toBe(0);
  });
});
