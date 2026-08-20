import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Public routing and QR payload lifecycle (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm11-public-routing-e2e-only-jwt-secret-not-for-production',
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
      throw new Error('Public routing E2E application did not initialize.');
    }
    return app;
  }

  async function createPublicDoctorFixture() {
    const unique = randomUUID();
    const baseNow = Date.now();
    const doctor = await prisma.user.create({
      data: {
        email: `public-routing-${unique}@example.test`,
        firstName: 'Public',
        lastName: 'Doctor',
        mobileNumber: `09${unique.replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-public-routing-e2e',
        role: 'DOCTOR',
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `LIC-${unique}`,
            profileDescription: 'Public routing E2E doctor',
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
      throw new Error(
        'Public Doctor fixture did not create required relations.',
      );
    }

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'Main Public Clinic',
        addressLine1: '1 Public Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
        services: {
          create: {
            name: 'Consultation',
            durationMinutes: 30,
            status: 'ACTIVE',
          },
        },
      },
    });

    return {
      doctorUserId: doctor.id,
      doctorPublicIdentifier: doctor.doctorProfile.publicIdentifier,
      entitlementId: doctor.doctorFinancialAccount.entitlement.id,
      locationId: location.id,
      locationPublicIdentifier: location.publicIdentifier,
    };
  }

  function qrPath(response: Response): string {
    const body = response.body as unknown as { qrPayload: string };
    return new URL(body.qrPayload).pathname;
  }

  it('emits Doctor and PracticeLocation QR payloads that resolve through the real public routes', async () => {
    const fixture = await createPublicDoctorFixture();
    const httpServer = getApp().getHttpServer();

    const doctorResponse = await request(httpServer)
      .get(`/public/doctors/${fixture.doctorPublicIdentifier}`)
      .expect(200);
    expect(doctorResponse.body).toEqual(
      expect.objectContaining({
        qrPayload: `https://app.example.test/public/doctors/${fixture.doctorPublicIdentifier}`,
        bookingEntryAllowed: true,
      }),
    );

    await request(httpServer).get(qrPath(doctorResponse)).expect(200);

    const locationResponse = await request(httpServer)
      .get(`/public/practice-locations/${fixture.locationPublicIdentifier}`)
      .expect(200);
    expect(locationResponse.body).toEqual(
      expect.objectContaining({
        qrPayload: `https://app.example.test/public/practice-locations/${fixture.locationPublicIdentifier}`,
        bookingEntryAllowed: true,
      }),
    );

    await request(httpServer).get(qrPath(locationResponse)).expect(200);
  });

  it('preserves the PracticeLocation QR through configuration edit, Disable and Reactivate', async () => {
    const fixture = await createPublicDoctorFixture();
    const httpServer = getApp().getHttpServer();
    const route = `/public/practice-locations/${fixture.locationPublicIdentifier}`;

    const initial = await request(httpServer).get(route).expect(200);
    const originalPayload = (initial.body as { qrPayload: string }).qrPayload;

    await prisma.practiceLocation.update({
      where: { id: fixture.locationId },
      data: { name: 'Renamed Public Clinic', addressLine1: '2 Updated Street' },
    });
    const afterEdit = await request(httpServer).get(route).expect(200);
    expect((afterEdit.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(afterEdit.body).toEqual(
      expect.objectContaining({ bookingEntryAllowed: true }),
    );

    await prisma.practiceLocation.update({
      where: { id: fixture.locationId },
      data: { lifecycleStatus: 'DISABLED' },
    });
    const disabled = await request(httpServer).get(route).expect(200);
    expect((disabled.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(disabled.body).toEqual(
      expect.objectContaining({
        routeStatus: 'TEMPORARILY_UNAVAILABLE',
        bookingEntryAllowed: false,
      }),
    );

    await prisma.practiceLocation.update({
      where: { id: fixture.locationId },
      data: { lifecycleStatus: 'ACTIVE' },
    });
    const reactivated = await request(httpServer).get(route).expect(200);
    expect((reactivated.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(reactivated.body).toEqual(
      expect.objectContaining({
        routeStatus: 'AVAILABLE',
        bookingEntryAllowed: true,
      }),
    );
  });

  it('keeps the Doctor QR stable in grace, suspension and administrative restriction without exposing the reason', async () => {
    const fixture = await createPublicDoctorFixture();
    const httpServer = getApp().getHttpServer();
    const route = `/public/doctors/${fixture.doctorPublicIdentifier}`;
    const initial = await request(httpServer).get(route).expect(200);
    const originalPayload = (initial.body as { qrPayload: string }).qrPayload;

    const gracePaidThrough = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.doctorSubscriptionEntitlement.update({
      where: { id: fixture.entitlementId },
      data: {
        paidThrough: gracePaidThrough,
        graceEndsAt: new Date(
          gracePaidThrough.getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
    });
    const grace = await request(httpServer).get(route).expect(200);
    expect((grace.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(grace.body).toEqual(
      expect.objectContaining({
        routeStatus: 'AVAILABLE',
        bookingEntryAllowed: true,
      }),
    );

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
    const suspended = await request(httpServer).get(route).expect(200);
    expect((suspended.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(suspended.body).toEqual(
      expect.objectContaining({
        routeStatus: 'TEMPORARILY_UNAVAILABLE',
        bookingEntryAllowed: false,
      }),
    );
    expect(JSON.stringify(suspended.body)).not.toContain('billing');
    expect(JSON.stringify(suspended.body)).not.toContain('SUSPENDED');

    await prisma.user.update({
      where: { id: fixture.doctorUserId },
      data: { administrativeRestrictionStatus: 'SUSPENDED' },
    });
    const restricted = await request(httpServer).get(route).expect(200);
    expect((restricted.body as { qrPayload: string }).qrPayload).toBe(
      originalPayload,
    );
    expect(restricted.body).toEqual(
      expect.objectContaining({ bookingEntryAllowed: false }),
    );
    expect(JSON.stringify(restricted.body)).not.toContain('administrative');
  });

  it('retires public routes only on the approved permanent states', async () => {
    const httpServer = getApp().getHttpServer();
    const doctorFixture = await createPublicDoctorFixture();
    const doctorRoute = `/public/doctors/${doctorFixture.doctorPublicIdentifier}`;
    await request(httpServer).get(doctorRoute).expect(200);

    await prisma.user.update({
      where: { id: doctorFixture.doctorUserId },
      data: { accountStatus: 'PERMANENTLY_CLOSED' },
    });
    await request(httpServer).get(doctorRoute).expect(404);

    const locationFixture = await createPublicDoctorFixture();
    const locationRoute = `/public/practice-locations/${locationFixture.locationPublicIdentifier}`;
    await request(httpServer).get(locationRoute).expect(200);

    await prisma.practiceLocation.update({
      where: { id: locationFixture.locationId },
      data: { lifecycleStatus: 'PERMANENTLY_DELETED' },
    });
    await request(httpServer).get(locationRoute).expect(404);
  });
});
