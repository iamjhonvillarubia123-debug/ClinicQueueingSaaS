import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Public queue projection (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm11-public-queue-e2e-only-jwt-secret-not-for-production',
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

  beforeAll(async () => {
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

  afterAll(async () => {
    if (app) await app.close();

    for (const [key, originalValue] of Object.entries(originalEnvironment)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  function getApp(): INestApplication<App> {
    if (!app) {
      throw new Error('Public queue E2E application did not initialize.');
    }
    return app;
  }

  async function createFixture() {
    const unique = randomUUID();
    const baseNow = Date.now();
    const doctor = await prisma.user.create({
      data: {
        email: `public-queue-${unique}@example.test`,
        firstName: 'Queue',
        lastName: 'Doctor',
        mobileNumber: `09${unique.replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-public-queue-e2e',
        role: 'DOCTOR',
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `QUEUE-LIC-${unique}`,
            isProfilePublic: true,
          },
        },
        doctorFinancialAccount: {
          create: {
            entitlement: {
              create: {
                paidThrough: new Date(baseNow + 24 * 60 * 60 * 1000),
                graceEndsAt: new Date(baseNow + 8 * 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      },
      include: {
        doctorProfile: true,
        doctorFinancialAccount: { include: { entitlement: true } },
      },
    });

    if (!doctor.doctorProfile || !doctor.doctorFinancialAccount?.entitlement) {
      throw new Error('Public queue fixture did not create required relations.');
    }

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'Queue Clinic',
        addressLine1: '1 Queue Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    return {
      entitlementId: doctor.doctorFinancialAccount.entitlement.id,
      locationId: location.id,
      publicIdentifier: location.publicIdentifier,
    };
  }

  it('shows the approved ended state after ClinicDay closure without patient data', async () => {
    const fixture = await createFixture();
    const serviceDate = '2026-08-21';
    await prisma.clinicDay.create({
      data: {
        practiceLocationId: fixture.locationId,
        serviceDate: new Date('2026-08-21T00:00:00.000Z'),
        status: 'CLOSED',
      },
    });

    const response = await request(getApp().getHttpServer())
      .get(
        `/public/practice-locations/${fixture.publicIdentifier}/queue/${serviceDate}`,
      )
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        practiceLocationName: 'Queue Clinic',
        serviceDate,
        status: 'AVAILABLE',
        message: "TODAY'S QUEUE HAS ENDED",
        clinicDayStatus: 'CLOSED',
        nowServingQueueNumber: null,
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('patient');
    expect(JSON.stringify(response.body)).not.toContain('bookingReference');
  });

  it('uses neutral public queue wording after subscription suspension', async () => {
    const fixture = await createFixture();
    const suspendedPaidThrough = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await prisma.doctorSubscriptionEntitlement.update({
      where: { id: fixture.entitlementId },
      data: {
        paidThrough: suspendedPaidThrough,
        graceEndsAt: new Date(
          suspendedPaidThrough.getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
    });

    const response = await request(getApp().getHttpServer())
      .get(
        `/public/practice-locations/${fixture.publicIdentifier}/queue/2026-08-21`,
      )
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'TEMPORARILY_UNAVAILABLE',
        message:
          'The online queue display is temporarily unavailable. Please try again later.',
        nowServingQueueNumber: null,
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('billing');
    expect(JSON.stringify(response.body)).not.toContain('SUSPENDED');
  });
});
