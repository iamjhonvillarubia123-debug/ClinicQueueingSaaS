import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationType,
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

describe('Multi-person booking confirmation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s3b-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 51).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 52).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s3b-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s3b-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 53).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s3b-otp-hmac-v1',
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

  it('atomically confirms two members, creates one group token/outbox, and replays without duplicate artifacts', async () => {
    const fixture = await createBaseFixture(30, 18);
    const draft = await createVerifiedGroupDraft(fixture, 2);
    const idempotencyKey = `m6s3b-two-${fixture.scope}`;

    const first = await confirm(draft.bookingDraftId, idempotencyKey);
    expect(first.status).toBe(201);
    const firstBody = first.body as unknown as {
      bookingGroup: {
        serviceDate: string;
        appointments: Array<{
          bookingReference: string;
          queueNumber: number;
          firstName: string;
          lastName: string;
        }>;
      };
      bookingGroupAccessToken: {
        expiresAt: string;
        transport: string;
        token?: string;
      } | null;
      replayed: boolean;
    };

    expect(firstBody.replayed).toBe(false);
    expect(
      firstBody.bookingGroup.appointments.map((item) => item.queueNumber),
    ).toEqual([1, 2]);
    expect(firstBody.bookingGroupAccessToken).not.toBeNull();
    expect(firstBody.bookingGroupAccessToken?.transport).toBe(
      'HTTP_ONLY_COOKIE',
    );
    expect(typeof firstBody.bookingGroupAccessToken?.expiresAt).toBe('string');
    expect(firstBody.bookingGroupAccessToken).not.toHaveProperty('token');
    const firstCookies = first.headers['set-cookie'];
    expect(firstCookies).toEqual(expect.any(Array));
    const groupCookie = (firstCookies as unknown as string[]).find((value) =>
      value.startsWith('cq_booking_group_access='),
    );
    expect(groupCookie).toEqual(expect.any(String));
    expect(groupCookie).toContain('HttpOnly');
    expect(groupCookie).toContain('Secure');
    expect(groupCookie).toContain('SameSite=Strict');
    expect(groupCookie).toContain('Path=/patient-booking-groups');

    const confirmedGroup = await prisma.bookingGroup.findFirstOrThrow({
      where: {
        practiceLocationId: fixture.locationId,
        serviceDate: fixture.serviceDate,
      },
    });

    const replay = await confirm(draft.bookingDraftId, idempotencyKey);
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({
      bookingGroupAccessToken: null,
      replayed: true,
    });
    expect(replay.headers['set-cookie']).toBeUndefined();

    const [
      groups,
      appointments,
      counter,
      groupTokens,
      outboxes,
      commands,
      contacts,
      storedDraft,
      otp,
    ] = await Promise.all([
      prisma.bookingGroup.findMany({
        where: {
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
      prisma.bookingGroupAccessToken.findMany({
        where: { bookingGroupId: confirmedGroup.id },
      }),
      prisma.notificationOutbox.findMany({
        where: {
          bookingGroupId: confirmedGroup.id,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
        },
      }),
      prisma.commandIdempotency.findMany({
        where: {
          bookingDraftId: draft.bookingDraftId,
          commandType: CommandType.MULTI_PERSON_BOOKING_CONFIRM,
        },
      }),
      prisma.contactPreference.findMany({
        where: {
          appointment: { bookingGroupId: confirmedGroup.id },
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: draft.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: draft.otpVerificationId },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(appointments).toHaveLength(2);
    expect(appointments.map((item) => item.queueNumber)).toEqual([1, 2]);
    expect(
      appointments.every((item) => item.bookingGroupId === confirmedGroup.id),
    ).toBe(true);
    expect(
      appointments.every(
        (item) =>
          item.mobileNumberEncrypted === null &&
          item.mobileNumberHash === null &&
          item.mobileNumberLastFour === null,
      ),
    ).toBe(true);
    expect(counter?.lastAllocatedNumber).toBe(2);
    expect(groupTokens).toHaveLength(1);
    expect(groupTokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outboxes).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.resultBookingGroupId).toBe(confirmedGroup.id);
    expect(commands[0]?.resultBookingGroupAccessTokenId).toBeNull();
    expect(contacts).toHaveLength(2);
    expect(storedDraft.status).toBe('CONSUMED');
    expect(storedDraft.activeDraftKey).toBeNull();
    expect(otp.consumedAt).not.toBeNull();
    expect(otp.activeContextKey).toBeNull();
  }, 30_000);

  it('confirms the maximum five members with consecutive ordinary queue numbers', async () => {
    const fixture = await createBaseFixture(20, 18);
    const draft = await createVerifiedGroupDraft(fixture, 5);

    const response = await confirm(
      draft.bookingDraftId,
      `m6s3b-five-${fixture.scope}`,
    );
    expect(response.status).toBe(201);

    const appointments = await prisma.appointment.findMany({
      where: {
        practiceLocationId: fixture.locationId,
        serviceDate: fixture.serviceDate,
      },
      orderBy: { queueNumber: 'asc' },
    });
    const groups = await prisma.bookingGroup.findMany({
      where: {
        practiceLocationId: fixture.locationId,
        serviceDate: fixture.serviceDate,
      },
    });

    expect(groups).toHaveLength(1);
    expect(appointments).toHaveLength(5);
    expect(appointments.map((item) => item.queueNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      appointments.every((item) => item.waitingPlacementType === 'ORDINARY'),
    ).toBe(true);
  }, 30_000);

  it('rolls back the whole group when one member service becomes invalid after OTP verification', async () => {
    const fixture = await createBaseFixture(30, 18);
    const draft = await createVerifiedGroupDraft(fixture, 2);

    await prisma.practiceLocationService.update({
      where: { id: fixture.serviceId },
      data: { status: ServiceAvailabilityStatus.INACTIVE },
    });

    const response = await confirm(
      draft.bookingDraftId,
      `m6s3b-invalid-${fixture.scope}`,
    );
    expect(response.status).toBe(409);

    await expectRejectedState(fixture, draft);
  }, 30_000);

  it('rolls back the whole group and QueueCounter when combined member duration exceeds remaining capacity', async () => {
    const fixture = await createBaseFixture(45, 9);
    const draft = await createVerifiedGroupDraft(fixture, 2);

    const response = await confirm(
      draft.bookingDraftId,
      `m6s3b-capacity-${fixture.scope}`,
    );
    expect(response.status).toBe(409);

    await expectRejectedState(fixture, draft);
  }, 30_000);

  async function createBaseFixture(
    serviceDurationMinutes: number,
    maximumOperatingHour: number,
  ): Promise<BaseFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const localTime = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s3b-${scope.slice(0, 12)}@example.test`,
        firstName: 'Group',
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
        specialization: 'Group Confirmation Testing',
        licenseNumber: `M6G-${scope.slice(0, 12)}`,
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
        name: `M6 Group ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Group Confirmation Service',
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

  async function createVerifiedGroupDraft(
    fixture: BaseFixture,
    memberCount: number,
  ): Promise<DraftFixture> {
    const response = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: fixture.locationId,
        mode: 'MULTI_PERSON',
        mobileNumber: patientMobile(),
        serviceDate: fixture.serviceDate.toISOString().slice(0, 10),
        privacyNoticeVersion: 'm6s3b-e2e-v1',
        privacyNoticeAcknowledged: true,
        scheduledReminderOptIn: true,
        members: Array.from({ length: memberCount }, (_, index) => ({
          firstName: `Member${index + 1}`,
          lastName: 'Group',
          existingPatientResponse: 'NO',
          selectedServiceIds: [fixture.serviceId],
        })),
      })
      .expect(201);

    const body = response.body as unknown as {
      bookingDraft: { id: string };
      otpVerification: { id: string } | null;
    };
    if (!body.otpVerification) {
      throw new Error('Multi-person draft did not issue an OTP challenge.');
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

  async function expectRejectedState(
    fixture: BaseFixture,
    draft: DraftFixture,
  ): Promise<void> {
    const [
      groups,
      appointments,
      counter,
      commands,
      outboxes,
      storedDraft,
      otp,
    ] = await Promise.all([
      prisma.bookingGroup.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      }),
      prisma.appointment.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
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
        where: { bookingDraftId: draft.bookingDraftId },
      }),
      prisma.notificationOutbox.findMany({
        where: {
          practiceLocationId: fixture.locationId,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: draft.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: draft.otpVerificationId },
      }),
    ]);

    expect(groups).toHaveLength(0);
    expect(appointments).toHaveLength(0);
    expect(counter).toBeNull();
    expect(commands).toHaveLength(0);
    expect(outboxes).toHaveLength(0);
    expect(storedDraft.status).toBe('PENDING_OTP');
    expect(storedDraft.consumedAt).toBeNull();
    expect(storedDraft.activeDraftKey).not.toBeNull();
    expect(otp.verifiedAt).not.toBeNull();
    expect(otp.consumedAt).toBeNull();
    expect(otp.activeContextKey).not.toBeNull();
  }

  function patientMobile(prefix = '0917'): string {
    return `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  }
});
