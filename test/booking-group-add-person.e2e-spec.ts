import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  ClinicDayStatus,
  CommandType,
  NotificationType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
  Weekday,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type Fixture = {
  scope: string;
  doctorUserId: string;
  locationId: string;
  serviceId: string;
  serviceDate: Date;
  serviceDateText: string;
  bookingGroupId: string;
  rawGroupToken: string;
  originalAppointmentIds: string[];
  originalQueueNumbers: number[];
};

describe('BookingGroup Add Person controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm8s3-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 61).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 62).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm8s3-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm8s3-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 63).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm8s3-otp-hmac-v1',
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
    await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('adds exactly one new member, preserves existing Queue Numbers, and replays without duplicates', async () => {
    const fixture = await createFixture(2);
    const key = `m8s3-add-${fixture.scope}`;

    const first = await addPerson(fixture, key, 'Fresh', 'Member');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ replayed: false });

    const firstBody = first.body as unknown as {
      appointment: {
        id: string;
        bookingGroupId: string;
        queueNumber: number;
        firstName: string;
        lastName: string;
      };
      replayed: boolean;
    };
    expect(firstBody.appointment.bookingGroupId).toBe(fixture.bookingGroupId);
    expect(firstBody.appointment.queueNumber).toBe(3);

    const replay = await addPerson(fixture, key, 'Fresh', 'Member');
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({
      replayed: true,
      appointment: { id: firstBody.appointment.id, queueNumber: 3 },
    });

    const [appointments, commandRows, outboxes, tokens] = await Promise.all([
      prisma.appointment.findMany({
        where: { bookingGroupId: fixture.bookingGroupId },
        orderBy: { queueNumber: 'asc' },
      }),
      prisma.commandIdempotency.findMany({
        where: {
          commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
          bookingGroupId: fixture.bookingGroupId,
        },
      }),
      prisma.notificationOutbox.findMany({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
          appointmentId: firstBody.appointment.id,
        },
      }),
      prisma.bookingGroupAccessToken.findMany({
        where: { bookingGroupId: fixture.bookingGroupId },
      }),
    ]);

    expect(appointments).toHaveLength(3);
    expect(appointments.map((item) => item.queueNumber)).toEqual([1, 2, 3]);
    expect(
      appointments
        .filter((item) => fixture.originalAppointmentIds.includes(item.id))
        .map((item) => item.queueNumber),
    ).toEqual(fixture.originalQueueNumbers);

    const added = appointments.find((item) => item.id === firstBody.appointment.id);
    expect(added?.mobileNumberEncrypted).toBeNull();
    expect(added?.mobileNumberHash).toBeNull();
    expect(added?.mobileNumberLastFour).toBeNull();
    expect(added?.waitingPlacementType).toBe(WaitingPlacementType.ORDINARY);
    expect(added?.servingOrderKey).not.toBeNull();
    expect(commandRows).toHaveLength(1);
    expect(commandRows[0]?.resultAppointmentId).toBe(firstBody.appointment.id);
    expect(outboxes).toHaveLength(1);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.revokedAt).toBeNull();
  }, 30_000);

  it('rejects a sixth historical member without creating partial artifacts', async () => {
    const fixture = await createFixture(5);

    const beforeCounter = await prisma.queueCounter.findUnique({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      },
    });

    const response = await addPerson(
      fixture,
      `m8s3-max-${fixture.scope}`,
      'Sixth',
      'Member',
    );
    expect(response.status).toBe(409);

    const [appointments, commands, outboxes, afterCounter] = await Promise.all([
      prisma.appointment.findMany({ where: { bookingGroupId: fixture.bookingGroupId } }),
      prisma.commandIdempotency.findMany({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
        },
      }),
      prisma.notificationOutbox.findMany({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
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
    ]);

    expect(appointments).toHaveLength(5);
    expect(commands).toHaveLength(0);
    expect(outboxes).toHaveLength(0);
    expect(afterCounter?.lastAllocatedNumber).toBe(
      beforeCounter?.lastAllocatedNumber,
    );
  }, 30_000);

  it('rejects a revoked controller token without touching group state', async () => {
    const fixture = await createFixture(2);
    await prisma.bookingGroupAccessToken.updateMany({
      where: { bookingGroupId: fixture.bookingGroupId },
      data: { revokedAt: new Date() },
    });

    const response = await addPerson(
      fixture,
      `m8s3-revoked-${fixture.scope}`,
      'Blocked',
      'Member',
    );
    expect(response.status).toBe(401);

    const [appointments, commands] = await Promise.all([
      prisma.appointment.findMany({ where: { bookingGroupId: fixture.bookingGroupId } }),
      prisma.commandIdempotency.findMany({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
        },
      }),
    ]);
    expect(appointments).toHaveLength(2);
    expect(commands).toHaveLength(0);
  }, 30_000);

  it('serializes START CLINIC first, then rejects Add Person with no residue', async () => {
    const fixture = await createFixture(2);

    const blocker = new PrismaService();
    await blocker.$connect();
    const lockIdentity = `queue|${fixture.locationId}|${fixture.serviceDateText}`;

    try {
      const lockTransaction = blocker.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          lockIdentity,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const startPromise = startClinic(fixture);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const addPromise = addPerson(
        fixture,
        `m8s3-race-add-${fixture.scope}`,
        'Race',
        'Member',
      );

      await lockTransaction;
      const [startResult, addResult] = await Promise.all([
        startPromise,
        addPromise,
      ]);

      expect(startResult.status).toBe(201);
      expect(addResult.status).toBe(409);
    } finally {
      await blocker.$disconnect();
    }

    const [clinicDay, appointments, commands, outboxes, counter] =
      await Promise.all([
        prisma.clinicDay.findUniqueOrThrow({
          where: {
            practiceLocationId_serviceDate: {
              practiceLocationId: fixture.locationId,
              serviceDate: fixture.serviceDate,
            },
          },
        }),
        prisma.appointment.findMany({
          where: { bookingGroupId: fixture.bookingGroupId },
          orderBy: { queueNumber: 'asc' },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            bookingGroupId: fixture.bookingGroupId,
            commandType: CommandType.BOOKING_GROUP_ADD_PERSON,
          },
        }),
        prisma.notificationOutbox.findMany({
          where: {
            bookingGroupId: fixture.bookingGroupId,
            notificationType: NotificationType.BOOKING_CONFIRMATION,
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
      ]);

    expect(clinicDay.status).toBe(ClinicDayStatus.STARTED);
    expect(appointments).toHaveLength(2);
    expect(appointments.map((item) => item.queueNumber)).toEqual([1, 2]);
    expect(commands).toHaveLength(0);
    expect(outboxes).toHaveLength(0);
    expect(counter?.lastAllocatedNumber).toBe(2);
  }, 30_000);

  async function createFixture(memberCount: number): Promise<Fixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 5);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const serviceDateText = serviceDate.toISOString().slice(0, 10);

    const doctorUser = await prisma.user.create({
      data: {
        email: `m8s3-${scope.slice(0, 12)}@example.test`,
        firstName: 'Add',
        lastName: 'Doctor',
        mobileNumber: patientMobile('0918'),
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        professionalTitle: 'Dr.',
        specialization: 'Add Person Testing',
        licenseNumber: `M8A-${scope.slice(0, 12)}`,
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
        name: `M8 Add ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Add Person Service',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });

    const weekday = weekdayFromDate(serviceDate);
    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId: location.id,
        weekday,
        isOpen: true,
        opensAtLocal: timeValue(8, 0),
        closesAtLocal: timeValue(17, 0),
        maximumOnlineBookingUntilLocal: timeValue(16, 0),
        maximumOperatingUntilLocal: timeValue(20, 0),
      },
    });

    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: `enc-${scope}`,
        controllingMobileNumberHash: createHash('sha256')
          .update(`controller-${scope}`)
          .digest('hex'),
        controllingMobileLastFour: '0001',
      },
    });

    const originalAppointmentIds: string[] = [];
    const originalQueueNumbers: number[] = [];
    for (let index = 1; index <= memberCount; index += 1) {
      const appointment = await prisma.appointment.create({
        data: {
          bookingReference: `M8A-${scope.slice(0, 8)}-${index}`,
          practiceLocationId: location.id,
          bookingGroupId: group.id,
          serviceDate,
          estimatedServiceMinutes: 30,
          queueNumber: index,
          status: AppointmentStatus.WAITING,
          servingOrderKey: index,
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          firstName: `Original${index}`,
          lastName: 'Member',
          existingPatientResponse: 'NO',
          mobileNumberEncrypted: null,
          mobileNumberHash: null,
          mobileNumberLastFour: null,
          activeAppointmentKey: null,
        },
      });
      originalAppointmentIds.push(appointment.id);
      originalQueueNumbers.push(index);
    }

    await prisma.queueCounter.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        lastAllocatedNumber: memberCount,
      },
    });

    const rawGroupToken = Buffer.from(randomUUID())
      .toString('base64url')
      .replaceAll('=', '');
    await prisma.bookingGroupAccessToken.create({
      data: {
        bookingGroupId: group.id,
        tokenHash: createHash('sha256')
          .update(rawGroupToken, 'utf8')
          .digest('hex'),
        purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
        expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
      },
    });

    return {
      scope,
      doctorUserId: doctorUser.id,
      locationId: location.id,
      serviceId: service.id,
      serviceDate,
      serviceDateText,
      bookingGroupId: group.id,
      rawGroupToken,
      originalAppointmentIds,
      originalQueueNumbers,
    };
  }

  function addPerson(
    fixture: Fixture,
    idempotencyKey: string,
    firstName: string,
    lastName: string,
  ) {
    return request(app.getHttpServer())
      .post(`/patient-booking-groups/${fixture.bookingGroupId}/add-person`)
      .set('Cookie', `cq_booking_group_access=${fixture.rawGroupToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .set('Origin', testEnvironment.WEB_APP_ORIGIN)
      .send({
        firstName,
        lastName,
        existingPatientResponse: 'NO',
        selectedServiceIds: [fixture.serviceId],
      });
  }

  async function startClinic(fixture: Fixture) {
    const authCookie = await loginDoctor(fixture.doctorUserId);
    return request(app.getHttpServer())
      .post('/queue/start-clinic')
      .set('Cookie', authCookie)
      .set('Idempotency-Key', `m8s3-race-start-${fixture.scope}`)
      .set('Origin', testEnvironment.WEB_APP_ORIGIN)
      .send({
        practiceLocationId: fixture.locationId,
        serviceDate: fixture.serviceDateText,
      });
  }

  async function loginDoctor(doctorUserId: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: doctorUserId },
      select: { email: true },
    });
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', testEnvironment.WEB_APP_ORIGIN)
      .send({
        email: user.email,
        password: 'irrelevant-e2e-password',
      });
    const header = response.headers['set-cookie'];
    const setCookie = Array.isArray(header) ? header : header ? [header] : [];
    if (!setCookie[0]) {
      throw new Error('Doctor login did not return an authentication cookie.');
    }
    return setCookie[0].split(';')[0];
  }

  function weekdayFromDate(date: Date): Weekday {
    const weekdays = [
      Weekday.SUNDAY,
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
    ];
    const weekday = weekdays[date.getUTCDay()];
    if (!weekday) throw new Error('Unable to resolve fixture weekday.');
    return weekday;
  }

  function timeValue(hour: number, minute: number): Date {
    return new Date(Date.UTC(1970, 0, 1, hour, minute));
  }

  function patientMobile(prefix = '0917'): string {
    return `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  }
});
