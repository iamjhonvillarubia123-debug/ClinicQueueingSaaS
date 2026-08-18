import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  BookingAccessTokenPurpose,
  BookingGroupAccessTokenPurpose,
  CommandType,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { BookingGroupMemberCancellationService } from './../src/booking/booking-group-member-cancellation.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type Fixture = {
  locationId: string;
  serviceDate: Date;
  groupAId: string;
  groupBId: string;
  groupAToken: string;
  memberAId: string;
  memberBId: string;
  appointmentToken: string;
};

type ErrorBody = { message?: string };

describe('Milestone 8 patient access scope boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cancellation: BookingGroupMemberCancellationService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm8-closure-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 81).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 82).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm8-closure-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm8-closure-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 83).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm8-closure-otp-hmac-v1',
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
    cancellation = moduleFixture.get(BookingGroupMemberCancellationService);
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

  it('rejects an Appointment credential presented to the BookingGroup dashboard', async () => {
    const fixture = await createFixture();

    const response = await request(app.getHttpServer())
      .get('/patient-booking-groups/dashboard')
      .set('Cookie', `cq_booking_group_access=${fixture.appointmentToken}`);

    expect(response.status).toBe(401);
    expect(errorBody(response).message).toBe(
      'Booking group access is unavailable.',
    );
  }, 30_000);

  it('does not let one valid controller credential cancel another BookingGroup member', async () => {
    const fixture = await createFixture();
    const before = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.memberBId },
    });

    await expect(
      cancellation.cancel(
        fixture.groupAId,
        fixture.memberBId,
        fixture.groupAToken,
        { reason: 'PATIENT_REQUESTED' },
        `m8-cross-group-cancel-${randomUUID()}`,
      ),
    ).rejects.toThrow('BookingGroup member was not found.');

    const [after, commands, events] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({
        where: { id: fixture.memberBId },
      }),
      prisma.commandIdempotency.count({
        where: {
          commandType: CommandType.BOOKING_GROUP_CANCEL_MEMBER,
          bookingGroupId: fixture.groupAId,
          appointmentId: fixture.memberBId,
        },
      }),
      prisma.queueEvent.count({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      }),
    ]);

    expect(after.status).toBe(before.status);
    expect(after.bookingGroupId).toBe(fixture.groupBId);
    expect(after.queueNumber).toBe(before.queueNumber);
    expect(commands).toBe(0);
    expect(events).toBe(0);
  }, 30_000);

  async function createFixture(): Promise<Fixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 5);
    serviceDate.setUTCHours(0, 0, 0, 0);

    const doctor = await prisma.user.create({
      data: {
        email: `m8-closure-${scope.slice(0, 12)}@example.test`,
        firstName: 'Scope',
        lastName: 'Doctor',
        mobileNumber: `0916${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Scope Boundary Testing',
        licenseNumber: `M8C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M8 Closure ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const groupA = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: `enc-a-${scope}`,
        controllingMobileNumberHash: tokenHash(`mobile-a-${scope}`),
        controllingMobileLastFour: '1001',
      },
    });
    const groupB = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: `enc-b-${scope}`,
        controllingMobileNumberHash: tokenHash(`mobile-b-${scope}`),
        controllingMobileLastFour: '1002',
      },
    });

    const memberA = await createMember(
      groupA.id,
      location.id,
      serviceDate,
      1,
      `${scope}-A`,
    );
    const memberB = await createMember(
      groupB.id,
      location.id,
      serviceDate,
      2,
      `${scope}-B`,
    );

    const groupAToken = rawToken();
    await prisma.bookingGroupAccessToken.create({
      data: {
        bookingGroupId: groupA.id,
        tokenHash: tokenHash(groupAToken),
        purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
        expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
      },
    });

    const appointmentToken = rawToken();
    await prisma.bookingAccessToken.create({
      data: {
        appointmentId: memberA.id,
        tokenHash: tokenHash(appointmentToken),
        purpose: BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING,
        expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
      },
    });

    return {
      locationId: location.id,
      serviceDate,
      groupAId: groupA.id,
      groupBId: groupB.id,
      groupAToken,
      memberAId: memberA.id,
      memberBId: memberB.id,
      appointmentToken,
    };
  }

  async function createMember(
    bookingGroupId: string,
    practiceLocationId: string,
    serviceDate: Date,
    queueNumber: number,
    identity: string,
  ) {
    return prisma.appointment.create({
      data: {
        bookingReference: `M8C-${identity.slice(0, 20)}`,
        practiceLocationId,
        bookingGroupId,
        serviceDate,
        estimatedServiceMinutes: 20,
        queueNumber,
        status: AppointmentStatus.WAITING,
        servingOrderKey: queueNumber,
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        firstName: 'Boundary',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        activeAppointmentKey: tokenHash(`active-${identity}`),
      },
    });
  }

  function rawToken(): string {
    return `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
  }

  function tokenHash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  function errorBody(response: { body: unknown }): ErrorBody {
    return response.body as ErrorBody;
  }
});
