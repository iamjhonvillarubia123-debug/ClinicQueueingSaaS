import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  Prisma,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { OtpGenerator } from './../src/otp/otp.generator';
import { PrismaService } from './../src/prisma/prisma.service';

const KNOWN_BOOKING_OTP = '123456';

type RaceFixture = {
  scope: string;
  serviceDate: Date;
  doctorProfileId: string;
  entitlementId: string;
  scheduleExceptionId: string;
  locationId: string;
  bookingDraftId: string;
  otpVerificationId: string;
};

describe('Individual booking confirmation admission races (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s2-admission-races-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 31).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 32).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s2-races-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s2-races-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 33).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s2-races-otp-v1',
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
    })
      .overrideProvider(OtpGenerator)
      .useValue({ generate: () => KNOWN_BOOKING_OTP })
      .compile();

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
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('serializes a concurrent schedule closure ahead of confirmation and rejects without consuming queue identity', async () => {
    const fixture = await createFixture();
    const barrier = createBarrier();

    const scheduleChange = prisma.$transaction(async (transaction) => {
      const scope = `DOCTOR_SCHEDULE|${fixture.doctorProfileId}`;
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
      `);
      await transaction.scheduleException.update({
        where: { id: fixture.scheduleExceptionId },
        data: { isOpen: false },
      });
      barrier.signalLocked();
      await barrier.waitForRelease();
    });

    await barrier.waitUntilLocked();
    const confirmation = request(app.getHttpServer())
      .post(`/booking/draft/${fixture.bookingDraftId}/confirm`)
      .set('Idempotency-Key', `m6s2-schedule-race-${fixture.scope}`)
      .then((response) => response);

    await waitForBlockedConfirmation();
    barrier.release();
    await scheduleChange;

    const response = await confirmation;
    expect(response.status).toBe(409);
    await expectRejectedState(fixture);
  }, 30_000);

  it('serializes a concurrent subscription expiry ahead of confirmation and rejects without consuming queue identity', async () => {
    const fixture = await createFixture();
    const barrier = createBarrier();

    const entitlementChange = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "DoctorSubscriptionEntitlement"
        WHERE "id" = ${fixture.entitlementId}
        FOR UPDATE
      `);
      await transaction.doctorSubscriptionEntitlement.update({
        where: { id: fixture.entitlementId },
        data: {
          paidThrough: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          graceEndsAt: new Date(Date.now() - 60_000),
        },
      });
      barrier.signalLocked();
      await barrier.waitForRelease();
    });

    await barrier.waitUntilLocked();
    const confirmation = request(app.getHttpServer())
      .post(`/booking/draft/${fixture.bookingDraftId}/confirm`)
      .set('Idempotency-Key', `m6s2-subscription-race-${fixture.scope}`)
      .then((response) => response);

    await waitForBlockedConfirmation();
    barrier.release();
    await entitlementChange;

    const response = await confirmation;
    expect(response.status).toBe(409);
    await expectRejectedState(fixture);
  }, 30_000);

  async function createFixture(): Promise<RaceFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const patientMobile = `0917${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const serviceDateText = serviceDate.toISOString().slice(0, 10);
    const localTime = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s2-races-${scope.slice(0, 12)}@example.test`,
        firstName: 'Admission',
        lastName: 'Race',
        mobileNumber: `0918${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    });
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        professionalTitle: 'Dr.',
        specialization: 'Admission Race Testing',
        licenseNumber: `M6RACE-${scope.slice(0, 10)}`,
      },
    });
    await prisma.doctorAccountSettings.create({
      data: {
        doctorProfileId: doctorProfile.id,
        allowOnlineBooking: true,
        maximumAdvanceBookingDays: 30,
        maximumEstimatedServiceMinutesPerPatient: 120,
      },
    });
    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctorUser.id },
    });
    const entitlement = await prisma.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        paidThrough: new Date(serviceDate.getTime() + 20 * 24 * 60 * 60 * 1000),
        graceEndsAt: new Date(serviceDate.getTime() + 27 * 24 * 60 * 60 * 1000),
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        name: `M6 Admission Race ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Admission Race Service',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });
    const scheduleException = await prisma.scheduleException.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        isOpen: true,
        opensAtLocal: localTime(8),
        closesAtLocal: localTime(17),
        maximumOperatingUntilLocal: localTime(18),
      },
    });

    const draftResponse = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: location.id,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        lastName: 'Reyes',
        existingPatientResponse: 'NO',
        mobileNumber: patientMobile,
        serviceDate: serviceDateText,
        privacyNoticeVersion: 'm6s2-races-v1',
        privacyNoticeAcknowledged: true,
        selectedServiceIds: [service.id],
      })
      .expect(201);

    const draftBody = draftResponse.body as unknown as {
      bookingDraft: { id: string };
      otpVerification: { id: string } | null;
    };
    if (!draftBody.otpVerification) {
      throw new Error('Booking draft did not issue an OTP challenge.');
    }

    await request(app.getHttpServer())
      .post('/booking/verify-otp')
      .send({ bookingDraftId: draftBody.bookingDraft.id, otp: KNOWN_BOOKING_OTP })
      .expect(201);

    return {
      scope,
      serviceDate,
      doctorProfileId: doctorProfile.id,
      entitlementId: entitlement.id,
      scheduleExceptionId: scheduleException.id,
      locationId: location.id,
      bookingDraftId: draftBody.bookingDraft.id,
      otpVerificationId: draftBody.otpVerification.id,
    };
  }

  async function expectRejectedState(fixture: RaceFixture): Promise<void> {
    const [counter, appointmentCount, draft, otp] = await Promise.all([
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: fixture.locationId,
            serviceDate: fixture.serviceDate,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: fixture.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: fixture.otpVerificationId },
      }),
    ]);

    expect(counter).toBeNull();
    expect(appointmentCount).toBe(0);
    expect(draft.status).not.toBe('CONSUMED');
    expect(draft.consumedAt).toBeNull();
    expect(draft.activeDraftKey).not.toBeNull();
    expect(otp.verifiedAt).not.toBeNull();
    expect(otp.consumedAt).toBeNull();
    expect(otp.activeContextKey).not.toBeNull();
  }
});

function createBarrier() {
  let signalLocked: (() => void) | undefined;
  let release: (() => void) | undefined;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    signalLocked: () => signalLocked?.(),
    waitUntilLocked: () => locked,
    waitForRelease: () => released,
    release: () => release?.(),
  };
}

async function waitForBlockedConfirmation(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}
