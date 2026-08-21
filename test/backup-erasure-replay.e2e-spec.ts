import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  AppointmentStatus,
  BookingRecoveryAttemptStatus,
  PrivacyErasureResourceType,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { BackupErasureReplayService } from './../src/privacy-retention/backup-erasure-replay.service';
import { PrismaService } from './../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Backup erasure replay (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let replay: BackupErasureReplayService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12-backup-replay-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 91).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 92).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm12-backup-replay-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm12-backup-replay-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 93).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm12-backup-replay-otp-v1',
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
    replay = moduleFixture.get(BackupErasureReplayService);
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.privacyErasureLedger.deleteMany();
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
        email: `m12-backup-${unique.slice(0, 12)}@example.test`,
        firstName: 'Backup',
        lastName: 'Replay',
        mobileNumber: `0917${unique.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Privacy Controls',
        licenseNumber: `M12-BACKUP-${unique.slice(0, 10)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: 'ACTIVE',
        name: `Backup Replay Clinic ${unique.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    return { location, unique };
  }

  it('replays a still-valid erasure ledger against restored Appointment correlation without double-counting analytics', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const { location, unique } = await createLocation();
    const serviceDate = new Date('2026-08-20T00:00:00.000Z');
    const appointmentId = randomUUID();

    await prisma.queueAnalyticsDaily.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        bookedCount: 1,
        servedCount: 1,
        cancelledCount: 0,
        absenceCount: 0,
      },
    });

    await prisma.privacyErasureLedger.create({
      data: {
        resourceType: PrivacyErasureResourceType.APPOINTMENT,
        resourceId: appointmentId,
        erasureCommittedAt: new Date(now.getTime() - DAY_MS),
        backupReplayUntil: new Date(now.getTime() + 14 * DAY_MS),
        createdAt: new Date(now.getTime() - DAY_MS),
      },
    });

    await prisma.appointment.create({
      data: {
        id: appointmentId,
        bookingReference: `M12-RESTORED-${unique.slice(0, 10)}`,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 15,
        queueNumber: 1,
        status: AppointmentStatus.COMPLETED,
        terminalAt: new Date(now.getTime() - 2 * DAY_MS),
        firstName: 'Restored',
        lastName: 'Patient',
        mobileNumberEncrypted: 'restored-protected-mobile',
        mobileNumberHash: createHash('sha256')
          .update(`appointment-${unique}`)
          .digest('hex'),
        mobileNumberLastFour: '1234',
      },
    });

    const rawToken = `m12-backup-token-${unique}`;
    await prisma.bookingAccessToken.create({
      data: {
        appointmentId,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        purpose: 'VIEW_AND_MANAGE_BOOKING',
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    const recovery = await prisma.bookingRecoveryAttempt.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        mobileNumberEncrypted: 'restored-recovery-mobile',
        mobileNumberHash: createHash('sha256')
          .update(`recovery-${unique}`)
          .digest('hex'),
        mobileHashKeyVersion: 1,
        mobileNumberLastFour: '1234',
        status: BookingRecoveryAttemptStatus.COMPLETED,
        candidateAppointmentId: appointmentId,
        verifiedAt: new Date(now.getTime() - 3 * 60 * 1000),
        candidateConfirmedAt: new Date(now.getTime() - 2 * 60 * 1000),
        completedAt: new Date(now.getTime() - 60 * 1000),
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
    });

    await expect(replay.replayLoadedLedgers(now, 500)).resolves.toEqual({
      ledgersProcessed: 1,
      appointmentsReplayed: 1,
      alreadyAbsent: 0,
    });

    expect(
      await prisma.appointment.findUnique({ where: { id: appointmentId } }),
    ).toBeNull();
    expect(
      await prisma.bookingAccessToken.count({ where: { appointmentId } }),
    ).toBe(0);

    const recoveryAfter = await prisma.bookingRecoveryAttempt.findUniqueOrThrow(
      { where: { id: recovery.id } },
    );
    expect(recoveryAfter.candidateAppointmentId).toBeNull();
    expect(recoveryAfter.mobileNumberEncrypted).toBeNull();
    expect(recoveryAfter.mobileNumberHash).toBeNull();
    expect(recoveryAfter.mobileNumberLastFour).toBeNull();
    expect(recoveryAfter.protectedDataClearedAt).not.toBeNull();

    const analytics = await prisma.queueAnalyticsDaily.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: location.id,
          serviceDate,
        },
      },
    });
    expect(analytics.bookedCount).toBe(1);
    expect(analytics.servedCount).toBe(1);

    await expect(replay.replayLoadedLedgers(now, 500)).resolves.toEqual({
      ledgersProcessed: 1,
      appointmentsReplayed: 0,
      alreadyAbsent: 1,
    });

    const analyticsAfterReplay =
      await prisma.queueAnalyticsDaily.findUniqueOrThrow({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: location.id,
            serviceDate,
          },
        },
      });
    expect(analyticsAfterReplay.bookedCount).toBe(1);
    expect(analyticsAfterReplay.servedCount).toBe(1);
  });

  it('ignores expired replay ledgers', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const appointmentId = randomUUID();

    await prisma.privacyErasureLedger.create({
      data: {
        resourceType: PrivacyErasureResourceType.APPOINTMENT,
        resourceId: appointmentId,
        erasureCommittedAt: new Date(now.getTime() - 16 * DAY_MS),
        backupReplayUntil: new Date(now.getTime() - DAY_MS),
        createdAt: new Date(now.getTime() - 16 * DAY_MS),
      },
    });

    await expect(replay.replayLoadedLedgers(now, 500)).resolves.toEqual({
      ledgersProcessed: 0,
      appointmentsReplayed: 0,
      alreadyAbsent: 0,
    });
  });
});
