import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { OtpGenerator } from './../src/otp/otp.generator';
import { PrismaService } from './../src/prisma/prisma.service';

const KNOWN_BOOKING_OTP = '123456';
const DAY_MS = 24 * 60 * 60 * 1000;

type BaseFixture = {
  scope: string;
  serviceDate: Date;
  locationId: string;
  serviceId: string;
};

type DraftFixture = {
  bookingDraftId: string;
  otpVerificationId: string;
};

describe('Individual booking confirmation contention (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s2-contention-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 41).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 42).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s2-contention-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s2-contention-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 43).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s2-contention-otp-v1',
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

  it('allows only one confirmation when two different commands race on the same verified draft', async () => {
    const fixture = await createBaseFixture(120);
    const draft = await createVerifiedDraft(fixture, patientMobile());

    const [first, second] = await Promise.all([
      confirm(draft.bookingDraftId, `m6s2-same-draft-a-${fixture.scope}`),
      confirm(draft.bookingDraftId, `m6s2-same-draft-b-${fixture.scope}`),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const [appointments, counter, storedDraft, otp] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
        select: { queueNumber: true },
      }),
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: fixture.locationId,
            serviceDate: fixture.serviceDate,
          },
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: draft.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: draft.otpVerificationId },
      }),
    ]);

    expect(appointments).toHaveLength(1);
    expect(appointments[0]?.queueNumber).toBe(1);
    expect(counter?.lastAllocatedNumber).toBe(1);
    expect(storedDraft.status).toBe('CONSUMED');
    expect(storedDraft.activeDraftKey).toBeNull();
    expect(otp.consumedAt).not.toBeNull();
    expect(otp.activeContextKey).toBeNull();
  }, 30_000);

  it('allows only one booking when two verified drafts compete for the last available capacity', async () => {
    const fixture = await createBaseFixture(40, 9);
    const firstDraft = await createVerifiedDraft(fixture, patientMobile());
    const secondDraft = await createVerifiedDraft(fixture, patientMobile());

    const [first, second] = await Promise.all([
      confirm(firstDraft.bookingDraftId, `m6s2-capacity-a-${fixture.scope}`),
      confirm(secondDraft.bookingDraftId, `m6s2-capacity-b-${fixture.scope}`),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const [
      appointments,
      counter,
      firstStored,
      secondStored,
      firstOtp,
      secondOtp,
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
        select: { queueNumber: true, bookingReference: true },
      }),
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: fixture.locationId,
            serviceDate: fixture.serviceDate,
          },
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: firstDraft.bookingDraftId },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: secondDraft.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: firstDraft.otpVerificationId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: secondDraft.otpVerificationId },
      }),
    ]);

    expect(appointments).toHaveLength(1);
    expect(appointments[0]?.queueNumber).toBe(1);
    expect(counter?.lastAllocatedNumber).toBe(1);

    const drafts = [firstStored, secondStored];
    expect(drafts.filter((item) => item.status === 'CONSUMED')).toHaveLength(1);
    const rejectedDraft = drafts.find((item) => item.status !== 'CONSUMED');
    expect(rejectedDraft?.consumedAt).toBeNull();
    expect(rejectedDraft?.activeDraftKey).not.toBeNull();

    const otps = [firstOtp, secondOtp];
    expect(otps.filter((item) => item.consumedAt !== null)).toHaveLength(1);
    const rejectedOtp = otps.find((item) => item.consumedAt === null);
    expect(rejectedOtp?.verifiedAt).not.toBeNull();
    expect(rejectedOtp?.activeContextKey).not.toBeNull();
  }, 30_000);

  async function createBaseFixture(
    serviceDurationMinutes: number,
    maximumOperatingHour = 18,
  ): Promise<BaseFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const localTime = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s2-contention-${scope.slice(0, 12)}@example.test`,
        firstName: 'Contention',
        lastName: 'Doctor',
        mobileNumber: patientMobile('0918'),
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
        specialization: 'Contention Testing',
        licenseNumber: `M6CONT-${scope.slice(0, 10)}`,
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
    await prisma.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        paidThrough: new Date(serviceDate.getTime() + 20 * DAY_MS),
        graceEndsAt: new Date(serviceDate.getTime() + 27 * DAY_MS),
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        name: `M6 Contention ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Contention Service',
        durationMinutes: serviceDurationMinutes,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });
    await prisma.scheduleException.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        isOpen: true,
        opensAtLocal: localTime(8),
        closesAtLocal: localTime(17),
        maximumOperatingUntilLocal: localTime(maximumOperatingHour),
      },
    });

    return {
      scope,
      serviceDate,
      locationId: location.id,
      serviceId: service.id,
    };
  }

  async function createVerifiedDraft(
    fixture: BaseFixture,
    mobileNumber: string,
  ): Promise<DraftFixture> {
    const draftResponse = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: fixture.locationId,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        lastName: 'Reyes',
        existingPatientResponse: 'NO',
        mobileNumber,
        serviceDate: fixture.serviceDate.toISOString().slice(0, 10),
        privacyNoticeVersion: 'm6s2-contention-v1',
        privacyNoticeAcknowledged: true,
        selectedServiceIds: [fixture.serviceId],
      })
      .expect(201);

    const body = draftResponse.body as unknown as {
      bookingDraft: { id: string };
      otpVerification: { id: string } | null;
    };
    if (!body.otpVerification) {
      throw new Error('Booking draft did not issue an OTP challenge.');
    }

    await request(app.getHttpServer())
      .post('/booking/verify-otp')
      .send({ bookingDraftId: body.bookingDraft.id, otp: KNOWN_BOOKING_OTP })
      .expect(201);

    return {
      bookingDraftId: body.bookingDraft.id,
      otpVerificationId: body.otpVerification.id,
    };
  }

  function confirm(bookingDraftId: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/booking/draft/${bookingDraftId}/confirm`)
      .set('Idempotency-Key', idempotencyKey)
      .then((response) => response);
  }

  function patientMobile(prefix = '0917'): string {
    return `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  }
});
