import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  AppointmentStatus,
  BookingRecoveryAttemptStatus,
  CommandType,
  OtpPurpose,
  PracticeLocationLifecycleStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { SecurityRetentionCleanupService } from './../src/privacy-retention/security-retention-cleanup.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Security retention cleanup (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let cleanup: SecurityRetentionCleanupService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12-security-retention-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 81).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 82).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm12-security-retention-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm12-security-retention-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 83).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm12-security-retention-otp-v1',
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
    cleanup = moduleFixture.get(SecurityRetentionCleanupService);
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();

    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function createLocation() {
    const unique = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m12-security-${unique.slice(0, 12)}@example.test`,
        firstName: 'Security',
        lastName: 'Retention',
        mobileNumber: `0918${unique.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Retention Controls',
        licenseNumber: `M12-RET-${unique.slice(0, 10)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `Retention Clinic ${unique.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    return { location, unique };
  }

  it('clears expired OTP secret state and mobile correlation on their approved clocks', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const { location, unique } = await createLocation();
    const serviceDate = new Date('2026-08-21T00:00:00.000Z');
    const recovery = await prisma.bookingRecoveryAttempt.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        mobileNumberEncrypted: `encrypted-${unique}`,
        mobileNumberHash: createHash('sha256').update(unique).digest('hex'),
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: '4567',
        status: BookingRecoveryAttemptStatus.PENDING_OTP,
        expiresAt: new Date(now.getTime() + DAY_MS),
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
      },
    });
    const otp = await prisma.otpVerification.create({
      data: {
        bookingRecoveryAttemptId: recovery.id,
        purpose: OtpPurpose.APPOINTMENT_RECOVERY,
        mobileNumberHash: createHash('sha256')
          .update(`mobile-${unique}`)
          .digest('hex'),
        mobileHashKeyVersion: 1,
        otpHash: createHash('sha256').update(`otp-${unique}`).digest('hex'),
        otpHashKeyVersion: 1,
        activeContextKey: `APPOINTMENT_RECOVERY:${unique}`,
        expiresAt: new Date(now.getTime() - 20 * 60 * 1000),
        createdAt: new Date(now.getTime() - 25 * HOUR_MS),
      },
    });

    const result = await cleanup.cleanupEligible(now, 500);

    expect(result.otpSecretsCleared).toBeGreaterThanOrEqual(1);
    expect(result.otpMobileContextCleared).toBeGreaterThanOrEqual(1);
    const after = await prisma.otpVerification.findUniqueOrThrow({
      where: { id: otp.id },
    });
    expect(after.otpHash).toBeNull();
    expect(after.otpHashKeyVersion).toBeNull();
    expect(after.activeContextKey).toBeNull();
    expect(after.mobileNumberHash).toBeNull();
    expect(after.mobileHashKeyVersion).toBeNull();
  });

  it('clears recovery identity but preserves the seven-day shell while a retained command depends on it', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const { location, unique } = await createLocation();
    const serviceDate = new Date('2026-08-14T00:00:00.000Z');
    const terminalAt = new Date(now.getTime() - 7 * DAY_MS);
    const appointment = await prisma.appointment.create({
      data: {
        bookingReference: `M12-RET-${unique.slice(0, 12)}`,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 15,
        queueNumber: 1,
        status: AppointmentStatus.WAITING,
        servingOrderKey: 1,
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        firstName: 'Recovery',
        lastName: 'Patient',
      },
    });
    const recovery = await prisma.bookingRecoveryAttempt.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        mobileNumberEncrypted: `encrypted-${unique}`,
        mobileNumberHash: createHash('sha256')
          .update(`recovery-${unique}`)
          .digest('hex'),
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: '7654',
        status: BookingRecoveryAttemptStatus.COMPLETED,
        candidateAppointmentId: appointment.id,
        verifiedAt: new Date(terminalAt.getTime() - 2 * 60 * 1000),
        candidateConfirmedAt: new Date(terminalAt.getTime() - 60 * 1000),
        completedAt: terminalAt,
        expiresAt: new Date(terminalAt.getTime() + 15 * 60 * 1000),
        createdAt: new Date(terminalAt.getTime() - 15 * 60 * 1000),
      },
    });
    const command = await prisma.commandIdempotency.create({
      data: {
        idempotencyKey: `m12-retention-${unique}`,
        commandIdentityKey: createHash('sha256')
          .update(`identity-${unique}`)
          .digest('hex'),
        commandType: CommandType.COMPLETE_APPOINTMENT_RECOVERY,
        requestFingerprint: createHash('sha256')
          .update(`fingerprint-${unique}`)
          .digest('hex'),
        practiceLocationId: location.id,
        serviceDate,
        appointmentId: appointment.id,
        bookingRecoveryAttemptId: recovery.id,
        resultAppointmentId: appointment.id,
        completedAt: terminalAt,
        expiresAt: now,
        createdAt: terminalAt,
      },
    });

    await cleanup.cleanupEligible(now, 500);

    const retained = await prisma.bookingRecoveryAttempt.findUniqueOrThrow({
      where: { id: recovery.id },
    });
    expect(retained.mobileNumberEncrypted).toBeNull();
    expect(retained.mobileNumberHash).toBeNull();
    expect(retained.mobileHashKeyVersion).toBeNull();
    expect(retained.mobileNumberLastFour).toBeNull();
    expect(retained.candidateAppointmentId).toBeNull();
    expect(retained.protectedDataClearedAt).not.toBeNull();

    await prisma.commandIdempotency.delete({ where: { id: command.id } });
    await cleanup.cleanupEligible(now, 500);

    expect(
      await prisma.bookingRecoveryAttempt.findUnique({
        where: { id: recovery.id },
      }),
    ).toBeNull();
  });
});
