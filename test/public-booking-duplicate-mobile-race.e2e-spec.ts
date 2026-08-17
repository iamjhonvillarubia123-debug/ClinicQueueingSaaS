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

describe('Public booking duplicate-mobile confirmation race (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s4-duplicate-mobile-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 71).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 72).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s4-duplicate-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s4-duplicate-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 73).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s4-duplicate-otp-v1',
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

  it('allows only one active public context when individual and group confirmations race on the same mobile scope', async () => {
    const fixture = await createBaseFixture();
    const individual = await createVerifiedIndividualDraft(
      fixture,
      patientMobile(),
    );
    const group = await createVerifiedGroupDraft(fixture, patientMobile());

    const individualDraft = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: individual.bookingDraftId },
      select: {
        mobileNumberEncrypted: true,
        mobileNumberHash: true,
        mobileNumberLastFour: true,
      },
    });
    if (
      !individualDraft.mobileNumberEncrypted ||
      !individualDraft.mobileNumberHash ||
      !individualDraft.mobileNumberLastFour
    ) {
      throw new Error('Individual draft protected mobile is incomplete.');
    }

    // Deliberately simulate inconsistent pre-confirmation state that normal
    // draft creation prevents. Confirmation must still enforce the approved
    // one-active-public-context rule across individual and group modes.
    await prisma.bookingDraft.update({
      where: { id: group.bookingDraftId },
      data: {
        mobileNumberEncrypted: individualDraft.mobileNumberEncrypted,
        mobileNumberHash: individualDraft.mobileNumberHash,
        mobileNumberLastFour: individualDraft.mobileNumberLastFour,
      },
    });

    const [individualResponse, groupResponse] = await Promise.all([
      confirm(
        individual.bookingDraftId,
        `m6s4-duplicate-individual-${fixture.scope}`,
      ),
      confirm(group.bookingDraftId, `m6s4-duplicate-group-${fixture.scope}`),
    ]);

    expect([individualResponse.status, groupResponse.status].sort()).toEqual([
      201, 409,
    ]);

    const [
      groups,
      appointments,
      counter,
      commands,
      individualStored,
      groupStored,
      individualOtp,
      groupOtp,
    ] = await Promise.all([
      prisma.bookingGroup.findMany({
        where: {
          controllingMobileNumberHash: individualDraft.mobileNumberHash,
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      }),
      prisma.appointment.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
        orderBy: { queueNumber: 'asc' },
      }),
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: fixture.locationId,
            serviceDate: fixture.serviceDate,
          },
        },
      }),
      prisma.commandIdempotency.findMany({
        where: {
          bookingDraftId: {
            in: [individual.bookingDraftId, group.bookingDraftId],
          },
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: individual.bookingDraftId },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: group.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: individual.otpVerificationId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: group.otpVerificationId },
      }),
    ]);

    const individualAppointments = appointments.filter(
      (item) =>
        item.bookingGroupId === null &&
        item.mobileNumberHash === individualDraft.mobileNumberHash,
    );
    expect(groups.length + individualAppointments.length).toBe(1);
    expect(commands).toHaveLength(1);

    const consumedDrafts = [individualStored, groupStored].filter(
      (item) => item.status === 'CONSUMED',
    );
    expect(consumedDrafts).toHaveLength(1);

    if (individualStored.status === 'CONSUMED') {
      expect(groups).toHaveLength(0);
      expect(appointments).toHaveLength(1);
      expect(appointments[0]?.queueNumber).toBe(1);
      expect(counter?.lastAllocatedNumber).toBe(1);
      expect(groupStored.consumedAt).toBeNull();
      expect(groupStored.activeDraftKey).not.toBeNull();
      expect(groupOtp.consumedAt).toBeNull();
      expect(groupOtp.activeContextKey).not.toBeNull();
    } else {
      expect(groups).toHaveLength(1);
      expect(appointments).toHaveLength(2);
      expect(appointments.map((item) => item.queueNumber)).toEqual([1, 2]);
      expect(counter?.lastAllocatedNumber).toBe(2);
      expect(individualStored.consumedAt).toBeNull();
      expect(individualStored.activeDraftKey).not.toBeNull();
      expect(individualOtp.consumedAt).toBeNull();
      expect(individualOtp.activeContextKey).not.toBeNull();
    }
  }, 30_000);

  async function createBaseFixture(): Promise<BaseFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const localTime = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s4-duplicate-${scope.slice(0, 12)}@example.test`,
        firstName: 'Duplicate',
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
        specialization: 'Duplicate Mobile Testing',
        licenseNumber: `M6DM-${scope.slice(0, 10)}`,
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
        name: `M6 Duplicate Mobile ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Duplicate Mobile Service',
        durationMinutes: 30,
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
        maximumOperatingUntilLocal: localTime(18),
      },
    });

    return {
      scope,
      serviceDate,
      locationId: location.id,
      serviceId: service.id,
    };
  }

  async function createVerifiedIndividualDraft(
    fixture: BaseFixture,
    mobileNumber: string,
  ): Promise<DraftFixture> {
    const response = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: fixture.locationId,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        lastName: 'Individual',
        existingPatientResponse: 'NO',
        mobileNumber,
        serviceDate: fixture.serviceDate.toISOString().slice(0, 10),
        privacyNoticeVersion: 'm6s4-duplicate-v1',
        privacyNoticeAcknowledged: true,
        selectedServiceIds: [fixture.serviceId],
      })
      .expect(201);

    return verifyDraftResponse(response.body);
  }

  async function createVerifiedGroupDraft(
    fixture: BaseFixture,
    mobileNumber: string,
  ): Promise<DraftFixture> {
    const response = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: fixture.locationId,
        mode: 'MULTI_PERSON',
        mobileNumber,
        serviceDate: fixture.serviceDate.toISOString().slice(0, 10),
        privacyNoticeVersion: 'm6s4-duplicate-v1',
        privacyNoticeAcknowledged: true,
        members: [
          {
            firstName: 'Maria',
            lastName: 'GroupOne',
            existingPatientResponse: 'NO',
            selectedServiceIds: [fixture.serviceId],
          },
          {
            firstName: 'Jose',
            lastName: 'GroupTwo',
            existingPatientResponse: 'NO',
            selectedServiceIds: [fixture.serviceId],
          },
        ],
      })
      .expect(201);

    return verifyDraftResponse(response.body);
  }

  async function verifyDraftResponse(
    bodyValue: unknown,
  ): Promise<DraftFixture> {
    const body = bodyValue as {
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
