import { createHash, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppointmentStatus } from '../generated/prisma/client';
import { AppModule } from '../src/app.module';
import { PatientBookingGroupAccessService } from '../src/patient-access/patient-booking-group-access.service';
import { AppointmentErasureService } from '../src/privacy-retention/appointment-erasure.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('BookingGroup final privacy erasure boundary (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let erasureService: AppointmentErasureService;
  let groupAccessService: PatientBookingGroupAccessService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12-group-erasure-e2e-only-jwt-secret-not-for-production',
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
    erasureService = moduleFixture.get(AppointmentErasureService);
    groupAccessService = moduleFixture.get(PatientBookingGroupAccessService);
    app = moduleFixture.createNestApplication();
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

  async function createFixture() {
    const unique = randomUUID();
    const doctor = await prisma.user.create({
      data: {
        email: `m12-group-erasure-${unique}@example.test`,
        firstName: 'Group',
        lastName: 'Doctor',
        mobileNumber: `09${unique.replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-m12-group-erasure-e2e',
        role: 'DOCTOR',
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `M12-GROUP-LIC-${unique}`,
            isProfilePublic: true,
          },
        },
      },
      include: { doctorProfile: true },
    });

    if (!doctor.doctorProfile) {
      throw new Error(
        'M12 group erasure fixture did not create DoctorProfile.',
      );
    }

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'Group Privacy Clinic',
        addressLine1: '1 Group Privacy Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const serviceDate = new Date('2026-08-20T00:00:00.000Z');
    const terminalAt = new Date('2026-08-20T00:00:00.000Z');
    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: 'group-controller-mobile',
        controllingMobileNumberHash: `group-hash-${unique}`,
        controllingMobileLastFour: '4321',
      },
    });

    const first = await prisma.appointment.create({
      data: {
        bookingReference: `M12-G1-${unique}`,
        practiceLocationId: location.id,
        bookingGroupId: group.id,
        serviceDate,
        estimatedServiceMinutes: 15,
        queueNumber: 1,
        status: AppointmentStatus.COMPLETED,
        terminalAt,
        firstName: 'First',
        lastName: 'Member',
        mobileNumberEncrypted: 'first-mobile',
        mobileNumberHash: `first-hash-${unique}`,
        mobileNumberLastFour: '1111',
      },
    });
    const second = await prisma.appointment.create({
      data: {
        bookingReference: `M12-G2-${unique}`,
        practiceLocationId: location.id,
        bookingGroupId: group.id,
        serviceDate,
        estimatedServiceMinutes: 15,
        queueNumber: 2,
        status: AppointmentStatus.COMPLETED,
        terminalAt,
        firstName: 'Second',
        lastName: 'Member',
        mobileNumberEncrypted: 'second-mobile',
        mobileNumberHash: `second-hash-${unique}`,
        mobileNumberLastFour: '2222',
      },
    });

    const rawToken = `G${unique.replaceAll('-', '')}`;
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const groupToken = await prisma.bookingGroupAccessToken.create({
      data: {
        bookingGroupId: group.id,
        tokenHash,
        purpose: 'CONTROLLER_ACCESS',
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    });

    const recovery = await prisma.bookingGroupRecoveryAttempt.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        mobileNumberEncrypted: 'group-recovery-mobile',
        mobileNumberHash: `group-recovery-${unique}`,
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: '4321',
        bookingGroupId: group.id,
        status: 'COMPLETED',
        verifiedAt: new Date('2026-08-20T01:00:00.000Z'),
        completedAt: new Date('2026-08-20T01:01:00.000Z'),
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    });

    const deliveryIdentityKey = createHash('sha256')
      .update(`m12-group:${group.id}`, 'utf8')
      .digest('hex');
    const outbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: 'BOOKING_CONFIRMATION',
        bookingGroupId: group.id,
        recipientMobileEncrypted: 'group-outbox-mobile',
        messageBodyEncrypted: 'group-confirmation-payload',
        providerIdempotencyKey: `provider-${unique}`,
        nextAttemptAt: new Date('2026-08-20T00:05:00.000Z'),
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    });
    await prisma.notificationLog.create({
      data: {
        notificationOutboxId: outbox.id,
        attemptNumber: 1,
        notificationType: 'BOOKING_CONFIRMATION',
        channel: 'SMS',
        outcome: 'SUCCESS',
        retryRecommended: false,
        submittedAt: new Date('2026-08-20T00:01:00.000Z'),
        resolvedAt: new Date('2026-08-20T00:01:01.000Z'),
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
    });

    return {
      first,
      second,
      group,
      groupToken,
      rawToken,
      recovery,
      outbox,
      now: new Date('2026-08-21T00:00:00.000Z'),
    };
  }

  it('preserves BookingGroup controller state while another member still remains', async () => {
    const fixture = await createFixture();

    await expect(
      erasureService.eraseEligibleAppointment(fixture.first.id, fixture.now),
    ).resolves.toEqual(expect.objectContaining({ outcome: 'ERASED' }));

    expect(
      await prisma.bookingGroup.findUnique({ where: { id: fixture.group.id } }),
    ).not.toBeNull();
    expect(
      await prisma.bookingGroupAccessToken.findUnique({
        where: { id: fixture.groupToken.id },
      }),
    ).not.toBeNull();
    expect(
      await prisma.bookingGroupRecoveryAttempt.findUnique({
        where: { id: fixture.recovery.id },
      }),
    ).toEqual(
      expect.objectContaining({
        bookingGroupId: fixture.group.id,
        mobileNumberEncrypted: 'group-recovery-mobile',
      }),
    );
    expect(
      await prisma.notificationOutbox.findUnique({
        where: { id: fixture.outbox.id },
      }),
    ).not.toBeNull();

    const groupAccess = await groupAccessService.establish(fixture.rawToken);
    expect(groupAccess.bookingGroup).toEqual(
      expect.objectContaining({
        id: fixture.group.id,
        members: [
          expect.objectContaining({
            bookingReference: fixture.second.bookingReference,
          }),
        ],
      }),
    );
  });

  it('removes BookingGroup identity, credentials, recovery correlation and notification history after the last member erases', async () => {
    const fixture = await createFixture();

    await erasureService.eraseEligibleAppointment(
      fixture.first.id,
      fixture.now,
    );
    await expect(
      erasureService.eraseEligibleAppointment(fixture.second.id, fixture.now),
    ).resolves.toEqual(expect.objectContaining({ outcome: 'ERASED' }));

    expect(
      await prisma.bookingGroup.findUnique({ where: { id: fixture.group.id } }),
    ).toBeNull();
    expect(
      await prisma.bookingGroupAccessToken.findUnique({
        where: { id: fixture.groupToken.id },
      }),
    ).toBeNull();
    await expect(
      groupAccessService.establish(fixture.rawToken),
    ).rejects.toThrow('Booking group access is unavailable.');

    const recoveryAfter =
      await prisma.bookingGroupRecoveryAttempt.findUniqueOrThrow({
        where: { id: fixture.recovery.id },
      });
    expect(recoveryAfter.bookingGroupId).toBeNull();
    expect(recoveryAfter.mobileNumberEncrypted).toBeNull();
    expect(recoveryAfter.mobileNumberHash).toBeNull();
    expect(recoveryAfter.mobileNumberLastFour).toBeNull();
    expect(recoveryAfter.protectedDataClearedAt).not.toBeNull();

    expect(
      await prisma.notificationOutbox.findUnique({
        where: { id: fixture.outbox.id },
      }),
    ).toBeNull();
    expect(
      await prisma.notificationLog.count({
        where: { notificationOutboxId: fixture.outbox.id },
      }),
    ).toBe(0);
  });
});
