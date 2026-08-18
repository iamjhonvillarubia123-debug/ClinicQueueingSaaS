import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  BookingGroupRecoveryAttemptStatus,
  CommandType,
  OtpPurpose,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { OtpService } from './../src/otp/otp.service';
import { BookingGroupRecoveryService } from './../src/patient-access/booking-group-recovery.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { MobileNumberService } from './../src/security/mobile-number/mobile-number.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type Fixture = {
  scope: string;
  practiceLocationId: string;
  serviceDate: string;
  bookingGroupId: string;
  appointmentIds: string[];
  queueNumbers: number[];
  controllingMobile: string;
  oldTokenIds: string[];
};

describe('BookingGroup recovery controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let recovery: BookingGroupRecoveryService;
  let otpService: OtpService;
  let mobileNumber: MobileNumberService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm8s2-e2e-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 71).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 72).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm8s2-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm8s2-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 73).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm8s2-otp-hmac-v1',
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
    recovery = moduleFixture.get(BookingGroupRecoveryService);
    otpService = moduleFixture.get(OtpService);
    mobileNumber = moduleFixture.get(MobileNumberService);

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

  it('atomically rotates controller credentials, consumes OTP, preserves appointments and replays without a second credential', async () => {
    const fixture = await createFixture(2);
    const beforeAppointments = await prisma.appointment.findMany({
      where: { bookingGroupId: fixture.bookingGroupId },
      orderBy: { queueNumber: 'asc' },
      select: { id: true, queueNumber: true, status: true },
    });

    const protectedMobile = mobileNumber.protect(fixture.controllingMobile);
    const now = new Date();
    const attempt = await prisma.bookingGroupRecoveryAttempt.create({
      data: {
        practiceLocationId: fixture.practiceLocationId,
        serviceDate: dateValue(fixture.serviceDate),
        mobileNumberEncrypted: protectedMobile.encrypted,
        mobileNumberHash: protectedMobile.hash,
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: protectedMobile.lastFour,
        bookingGroupId: fixture.bookingGroupId,
        status: BookingGroupRecoveryAttemptStatus.VERIFIED,
        verifiedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    const rawOtp = '482731';
    const otp = await prisma.otpVerification.create({
      data: {
        bookingGroupRecoveryAttemptId: attempt.id,
        mobileNumberHash: protectedMobile.hash,
        mobileHashKeyVersion: 1,
        otpHash: otpService.hashOtp(
          attempt.id,
          OtpPurpose.BOOKING_GROUP_RECOVERY,
          rawOtp,
        ),
        otpHashKeyVersion: 1,
        purpose: OtpPurpose.BOOKING_GROUP_RECOVERY,
        activeContextKey: `BOOKING_GROUP_RECOVERY:${attempt.id}`,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      },
    });
    await prisma.otpVerification.update({
      where: { id: otp.id },
      data: { verifiedAt: new Date() },
    });

    const key = `m8s2-recovery-${fixture.scope}`;
    const first = await recovery.complete(attempt.id, key);

    expect(first.replayed).toBe(false);
    expect(first.bookingGroupId).toBe(fixture.bookingGroupId);
    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [
      oldTokens,
      activeTokens,
      completedAttempt,
      consumedOtp,
      command,
      afterAppointments,
    ] = await Promise.all([
      prisma.bookingGroupAccessToken.findMany({
        where: { id: { in: fixture.oldTokenIds } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.bookingGroupAccessToken.findMany({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          tokenHash: { not: null },
        },
      }),
      prisma.bookingGroupRecoveryAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
      prisma.otpVerification.findUniqueOrThrow({ where: { id: otp.id } }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
          bookingGroupRecoveryAttemptId: attempt.id,
        },
      }),
      prisma.appointment.findMany({
        where: { bookingGroupId: fixture.bookingGroupId },
        orderBy: { queueNumber: 'asc' },
        select: { id: true, queueNumber: true, status: true },
      }),
    ]);

    expect(oldTokens).toHaveLength(2);
    expect(oldTokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(activeTokens).toHaveLength(1);
    expect(activeTokens[0]?.id).toBe(first.replacementTokenRecordId);
    expect(activeTokens[0]?.purpose).toBe(
      BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
    );
    expect(completedAttempt.status).toBe(
      BookingGroupRecoveryAttemptStatus.COMPLETED,
    );
    expect(completedAttempt.completedAt).not.toBeNull();
    expect(consumedOtp.consumedAt).not.toBeNull();
    expect(consumedOtp.activeContextKey).toBeNull();
    expect(consumedOtp.otpHash).toBeNull();
    expect(command.resultBookingGroupId).toBe(fixture.bookingGroupId);
    expect(command.resultBookingGroupAccessTokenId).toBe(
      first.replacementTokenRecordId,
    );
    expect(afterAppointments).toEqual(beforeAppointments);
    expect(afterAppointments.map((item) => item.id)).toEqual(
      fixture.appointmentIds,
    );
    expect(afterAppointments.map((item) => item.queueNumber)).toEqual(
      fixture.queueNumbers,
    );

    const replay = await recovery.complete(attempt.id, key);
    expect(replay).toEqual({
      replayed: true,
      bookingGroupId: fixture.bookingGroupId,
      replacementTokenRecordId: first.replacementTokenRecordId,
      rawToken: null,
    });
    expect(
      await prisma.bookingGroupAccessToken.count({
        where: { bookingGroupId: fixture.bookingGroupId },
      }),
    ).toBe(3);
    expect(
      await prisma.commandIdempotency.count({
        where: {
          commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
          bookingGroupRecoveryAttemptId: attempt.id,
        },
      }),
    ).toBe(1);
  });

  it('returns one controller cookie on first HTTP completion and no new cookie on compatible replay', async () => {
    const fixture = await createFixture(1);
    const protectedMobile = mobileNumber.protect(fixture.controllingMobile);
    const now = new Date();
    const attempt = await prisma.bookingGroupRecoveryAttempt.create({
      data: {
        practiceLocationId: fixture.practiceLocationId,
        serviceDate: dateValue(fixture.serviceDate),
        mobileNumberEncrypted: protectedMobile.encrypted,
        mobileNumberHash: protectedMobile.hash,
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: protectedMobile.lastFour,
        bookingGroupId: fixture.bookingGroupId,
        status: BookingGroupRecoveryAttemptStatus.VERIFIED,
        verifiedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    const otp = await prisma.otpVerification.create({
      data: {
        bookingGroupRecoveryAttemptId: attempt.id,
        mobileNumberHash: protectedMobile.hash,
        mobileHashKeyVersion: 1,
        otpHash: otpService.hashOtp(
          attempt.id,
          OtpPurpose.BOOKING_GROUP_RECOVERY,
          '927415',
        ),
        otpHashKeyVersion: 1,
        purpose: OtpPurpose.BOOKING_GROUP_RECOVERY,
        activeContextKey: `BOOKING_GROUP_RECOVERY:${attempt.id}`,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      },
    });
    await prisma.otpVerification.update({
      where: { id: otp.id },
      data: { verifiedAt: new Date() },
    });

    const key = `m8s2-http-${fixture.scope}`;
    const first: Response = await request(app.getHttpServer())
      .post(`/patient-booking-groups/recovery/${attempt.id}/complete`)
      .set('Origin', testEnvironment.WEB_APP_ORIGIN)
      .set('Idempotency-Key', key)
      .expect(201);

    expect(first.body).toEqual({
      replayed: false,
      accessRestored: true,
      credentialTransport: 'HTTP_ONLY_COOKIE',
    });
    const firstCookies = first.headers['set-cookie'];
    const firstCookieValues = Array.isArray(firstCookies)
      ? firstCookies
      : firstCookies
        ? [firstCookies]
        : [];
    expect(firstCookieValues).toHaveLength(1);
    expect(firstCookieValues[0]).toContain('cq_booking_group_access=');
    expect(firstCookieValues[0]).toContain('HttpOnly');
    expect(firstCookieValues[0]).toContain('Secure');
    expect(firstCookieValues[0]).toContain('SameSite=Strict');
    expect(firstCookieValues[0]).toContain('Path=/patient-booking-groups');

    const replay: Response = await request(app.getHttpServer())
      .post(`/patient-booking-groups/recovery/${attempt.id}/complete`)
      .set('Origin', testEnvironment.WEB_APP_ORIGIN)
      .set('Idempotency-Key', key)
      .expect(201);

    expect(replay.body).toEqual({
      replayed: true,
      accessRestored: true,
      credentialTransport: 'ALREADY_ISSUED',
    });
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('rejects an unverified recovery attempt without rotating any controller token', async () => {
    const fixture = await createFixture(1);
    const protectedMobile = mobileNumber.protect(fixture.controllingMobile);
    const now = new Date();
    const attempt = await prisma.bookingGroupRecoveryAttempt.create({
      data: {
        practiceLocationId: fixture.practiceLocationId,
        serviceDate: dateValue(fixture.serviceDate),
        mobileNumberEncrypted: protectedMobile.encrypted,
        mobileNumberHash: protectedMobile.hash,
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: protectedMobile.lastFour,
        bookingGroupId: fixture.bookingGroupId,
        status: BookingGroupRecoveryAttemptStatus.PENDING_OTP,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
    });
    const beforeTokens = await prisma.bookingGroupAccessToken.findMany({
      where: { bookingGroupId: fixture.bookingGroupId },
      orderBy: { createdAt: 'asc' },
    });

    await expect(
      recovery.complete(attempt.id, `m8s2-unverified-${fixture.scope}`),
    ).rejects.toThrow('Booking group recovery is unavailable.');

    const afterTokens = await prisma.bookingGroupAccessToken.findMany({
      where: { bookingGroupId: fixture.bookingGroupId },
      orderBy: { createdAt: 'asc' },
    });
    expect(afterTokens).toEqual(beforeTokens);
    expect(
      await prisma.commandIdempotency.count({
        where: { bookingGroupRecoveryAttemptId: attempt.id },
      }),
    ).toBe(0);
  });

  async function createFixture(memberCount: number): Promise<Fixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const controllingMobile = '09171234567';
    const protectedMobile = mobileNumber.protect(controllingMobile);

    const doctor = await prisma.user.create({
      data: {
        email: `m8s2-${scope.slice(0, 12)}@example.test`,
        firstName: 'Recovery',
        lastName: 'Doctor',
        mobileNumber: `0919${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Recovery Controls',
        licenseNumber: `M8R-${scope.slice(0, 10)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M8 Recovery ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: protectedMobile.encrypted,
        controllingMobileNumberHash: protectedMobile.hash,
        controllingMobileLastFour: protectedMobile.lastFour,
      },
    });

    const oldTokenIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const rawToken = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
      const token = await prisma.bookingGroupAccessToken.create({
        data: {
          bookingGroupId: group.id,
          tokenHash: createHash('sha256')
            .update(rawToken, 'utf8')
            .digest('hex'),
          purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
          expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
        },
      });
      oldTokenIds.push(token.id);
    }

    const appointments = await Promise.all(
      Array.from({ length: memberCount }, (_, index) =>
        prisma.appointment.create({
          data: {
            bookingReference: `M8R-${scope.slice(0, 8)}-${index + 1}`,
            practiceLocationId: location.id,
            bookingGroupId: group.id,
            serviceDate,
            estimatedServiceMinutes: 30,
            queueNumber: index + 11,
            status: AppointmentStatus.WAITING,
            servingOrderKey: index + 1,
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: `Member${index + 1}`,
            lastName: 'Recovery',
            activeAppointmentKey: createHash('sha256')
              .update(`${scope}|${index + 1}|active`)
              .digest('hex'),
          },
        }),
      ),
    );

    return {
      scope,
      practiceLocationId: location.id,
      serviceDate: serviceDate.toISOString().slice(0, 10),
      bookingGroupId: group.id,
      appointmentIds: appointments.map((item) => item.id),
      queueNumbers: appointments.map((item) => item.queueNumber),
      controllingMobile,
      oldTokenIds,
    };
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
