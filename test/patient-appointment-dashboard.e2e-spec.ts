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
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type Fixture = {
  scope: string;
  doctorUserId: string;
  locationId: string;
  serviceDate: Date;
  targetId: string;
  targetReference: string;
  targetToken: string;
  otherReference: string;
  groupToken: string;
  financialAccountId: string;
};

describe('Patient Appointment dashboard authorization controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm8s4-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 71).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 72).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm8s4-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm8s4-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 73).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm8s4-otp-hmac-v1',
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
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns only the authorized Appointment queue page with authoritative queue metrics', async () => {
    const fixture = await createFixture();
    const response = await dashboard(
      fixture.targetReference,
      `cq_booking_access=${fixture.targetToken}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      bookingReference: fixture.targetReference,
      patientName: {
        firstName: 'Target',
        lastName: 'Patient',
      },
      practiceLocation: {
        id: fixture.locationId,
      },
      queueNumber: 3,
      status: AppointmentStatus.WAITING,
      clinicDayStatus: ClinicDayStatus.STARTED,
      nowServingQueueNumber: 1,
      patientsAhead: 1,
      canUseImHere: false,
    });
    expect(response.body).not.toHaveProperty('mobileNumberEncrypted');
    expect(response.body).not.toHaveProperty('mobileNumberHash');
  }, 30_000);

  it('accepts VIEW_ONLY for reading but rejects cross-Appointment use', async () => {
    const fixture = await createFixture({
      purpose: BookingAccessTokenPurpose.VIEW_ONLY,
    });

    const own = await dashboard(
      fixture.targetReference,
      `cq_booking_access=${fixture.targetToken}`,
    );
    expect(own.status).toBe(200);

    const cross = await dashboard(
      fixture.otherReference,
      `cq_booking_access=${fixture.targetToken}`,
    );
    expect(cross.status).toBe(401);
    expect(cross.body.message).toBe('Patient booking access is unavailable.');
  }, 30_000);

  it('rejects group-token misuse, revoked/expired Appointment tokens, and anonymized access generically', async () => {
    const groupMisuse = await createFixture();
    const groupResponse = await dashboard(
      groupMisuse.targetReference,
      `cq_booking_access=${groupMisuse.groupToken}`,
    );
    expect(groupResponse.status).toBe(401);
    expect(groupResponse.body.message).toBe(
      'Patient booking access is unavailable.',
    );

    const revoked = await createFixture();
    await prisma.bookingAccessToken.update({
      where: { tokenHash: tokenHash(revoked.targetToken) },
      data: { revokedAt: new Date() },
    });
    const revokedResponse = await dashboard(
      revoked.targetReference,
      `cq_booking_access=${revoked.targetToken}`,
    );
    expect(revokedResponse.status).toBe(401);

    const expired = await createFixture();
    await prisma.bookingAccessToken.update({
      where: { tokenHash: tokenHash(expired.targetToken) },
      data: {
        createdAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const expiredResponse = await dashboard(
      expired.targetReference,
      `cq_booking_access=${expired.targetToken}`,
    );
    expect(expiredResponse.status).toBe(401);

    const anonymized = await createFixture();
    await prisma.appointment.update({
      where: { id: anonymized.targetId },
      data: {
        anonymizedAt: new Date(),
        firstName: null,
        middleName: null,
        lastName: null,
        suffix: null,
      },
    });
    const anonymizedResponse = await dashboard(
      anonymized.targetReference,
      `cq_booking_access=${anonymized.targetToken}`,
    );
    expect(anonymizedResponse.status).toBe(401);
    expect(anonymizedResponse.body.message).toBe(
      'Patient booking access is unavailable.',
    );
  }, 30_000);

  it("shows I'M HERE only for an eligible individual management token and never for a group member", async () => {
    const individual = await createFixture({ targetTemporarilyAbsent: true });
    const individualResponse = await dashboard(
      individual.targetReference,
      `cq_booking_access=${individual.targetToken}`,
    );
    expect(individualResponse.status).toBe(200);
    expect(individualResponse.body.canUseImHere).toBe(true);

    const grouped = await createFixture({
      targetTemporarilyAbsent: true,
      targetInGroup: true,
    });
    const groupedResponse = await dashboard(
      grouped.targetReference,
      `cq_booking_access=${grouped.targetToken}`,
    );
    expect(groupedResponse.status).toBe(200);
    expect(groupedResponse.body.canUseImHere).toBe(false);
  }, 30_000);

  it('returns neutral service-unavailable without cancelling the Appointment when subscription access lapses', async () => {
    const fixture = await createFixture();
    await prisma.doctorSubscriptionEntitlement.update({
      where: { doctorFinancialAccountId: fixture.financialAccountId },
      data: {
        paidThrough: new Date(Date.now() - 2 * DAY_MS),
        graceEndsAt: new Date(Date.now() - DAY_MS),
      },
    });

    const response = await dashboard(
      fixture.targetReference,
      `cq_booking_access=${fixture.targetToken}`,
    );
    expect(response.status).toBe(503);
    expect(response.body.message).toContain(
      'Your existing appointment has not been cancelled',
    );

    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: fixture.targetId },
    });
    expect(appointment.status).toBe(AppointmentStatus.WAITING);
  }, 30_000);

  async function createFixture(
    options: {
      purpose?: BookingAccessTokenPurpose;
      targetTemporarilyAbsent?: boolean;
      targetInGroup?: boolean;
    } = {},
  ): Promise<Fixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 3);
    serviceDate.setUTCHours(0, 0, 0, 0);

    const doctor = await prisma.user.create({
      data: {
        email: `m8s4-${scope.slice(0, 12)}@example.test`,
        firstName: 'Queue',
        lastName: 'Doctor',
        mobileNumber: `0917${scope.slice(0, 7)}`,
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
        specialization: 'Dashboard Testing',
        licenseNumber: `M8D-${scope.slice(0, 12)}`,
      },
    });
    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctor.id },
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
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        name: `M8 Dashboard ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    await prisma.clinicDay.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        status: ClinicDayStatus.STARTED,
        startedAt: new Date(),
      },
    });

    await prisma.appointment.create({
      data: {
        bookingReference: `M8D-${scope.slice(0, 8)}-CALLED`,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 20,
        queueNumber: 1,
        status: AppointmentStatus.CALLED,
        servingOrderKey: null,
        waitingPlacementType: null,
        firstName: 'Serving',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        activeAppointmentKey: createHash('sha256')
          .update(`${scope}|called`)
          .digest('hex'),
        calledAt: new Date(),
      },
    });

    await prisma.appointment.create({
      data: {
        bookingReference: `M8D-${scope.slice(0, 8)}-AHEAD`,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 20,
        queueNumber: 2,
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(1),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        firstName: 'Ahead',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        activeAppointmentKey: createHash('sha256')
          .update(`${scope}|ahead`)
          .digest('hex'),
      },
    });

    let bookingGroupId: string | undefined;
    let groupToken = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    if (options.targetInGroup) {
      const group = await prisma.bookingGroup.create({
        data: {
          practiceLocationId: location.id,
          serviceDate,
        },
      });
      bookingGroupId = group.id;
      await prisma.bookingGroupAccessToken.create({
        data: {
          bookingGroupId: group.id,
          tokenHash: tokenHash(groupToken),
          purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
          expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
        },
      });
    } else {
      const otherGroup = await prisma.bookingGroup.create({
        data: {
          practiceLocationId: location.id,
          serviceDate,
        },
      });
      await prisma.bookingGroupAccessToken.create({
        data: {
          bookingGroupId: otherGroup.id,
          tokenHash: tokenHash(groupToken),
          purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
          expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
        },
      });
    }

    const targetReference = `M8D-${scope.slice(0, 8)}-TARGET`;
    const target = await prisma.appointment.create({
      data: {
        bookingReference: targetReference,
        practiceLocationId: location.id,
        bookingGroupId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber: 3,
        status: options.targetTemporarilyAbsent
          ? AppointmentStatus.TEMPORARILY_ABSENT
          : AppointmentStatus.WAITING,
        servingOrderKey: options.targetTemporarilyAbsent
          ? null
          : new Prisma.Decimal(2),
        waitingPlacementType: options.targetTemporarilyAbsent
          ? null
          : WaitingPlacementType.ORDINARY,
        firstName: 'Target',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        activeAppointmentKey: createHash('sha256')
          .update(`${scope}|target`)
          .digest('hex'),
      },
    });

    const otherReference = `M8D-${scope.slice(0, 8)}-OTHER`;
    await prisma.appointment.create({
      data: {
        bookingReference: otherReference,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 20,
        queueNumber: 4,
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(3),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        firstName: 'Other',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        activeAppointmentKey: createHash('sha256')
          .update(`${scope}|other`)
          .digest('hex'),
      },
    });

    const rawToken = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await prisma.bookingAccessToken.create({
      data: {
        appointmentId: target.id,
        tokenHash: tokenHash(rawToken),
        purpose:
          options.purpose ?? BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING,
        expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
      },
    });

    return {
      scope,
      doctorUserId: doctor.id,
      locationId: location.id,
      serviceDate,
      targetId: target.id,
      targetReference,
      targetToken: rawToken,
      otherReference,
      groupToken,
      financialAccountId: financialAccount.id,
    };
  }

  function dashboard(bookingReference: string, cookie: string) {
    return request(app.getHttpServer())
      .get(`/patient-bookings/${encodeURIComponent(bookingReference)}/dashboard`)
      .set('Cookie', cookie);
  }

  function tokenHash(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
});
