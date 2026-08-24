import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from '../generated/prisma/client';
import { AppModule } from '../src/app.module';
import { CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION } from '../src/doctor/doctor-data-retention.service';
import { PracticeLocationActivationService } from '../src/practice-location/practice-location-activation.service';
import { PracticeLocationDataRetentionGateService } from '../src/practice-location/practice-location-data-retention-gate.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Doctor Data Retention activation boundary (e2e)', () => {
  let moduleFixture: TestingModule | undefined;
  let prisma: PrismaService;
  let gate: PracticeLocationDataRetentionGateService;
  let activation: PracticeLocationActivationService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12s8-e2e-only-jwt-secret-not-for-production',
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
      if (!process.env[key]) process.env[key] = value;
    }
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleFixture.get(PrismaService);
    gate = moduleFixture.get(PracticeLocationDataRetentionGateService);
    activation = moduleFixture.get(PracticeLocationActivationService);
  });

  afterAll(async () => {
    await moduleFixture?.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('blocks operational activation until the current Doctor acknowledgement is persisted', async () => {
    const unique = randomUUID();
    const doctor = await prisma.user.create({
      data: {
        email: `m12s8-${unique}@example.test`,
        firstName: 'Retention',
        lastName: 'Doctor',
        mobileNumber: `+63917${unique.replaceAll('-', '').slice(0, 7)}`,
        passwordHash: 'e2e-not-used',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'General Practice',
        licenseNumber: `M12S8-${unique}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
        name: `M12S8 Clinic ${unique}`,
        addressLine1: '123 Retention Street',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId: location.id,
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T09:00:00.000Z'),
        closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
      },
    });

    await expect(gate.assertCurrentAcknowledgement(doctor.id)).rejects.toThrow(ForbiddenException);
    expect(await prisma.practiceLocation.findUniqueOrThrow({ where: { id: location.id }, select: { lifecycleStatus: true } })).toEqual({ lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT });

    const acknowledgedAt = new Date();
    await prisma.doctorDataRetentionAcknowledgement.create({
      data: {
        doctorUserId: doctor.id,
        acknowledgementVersion: CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
        acknowledgedAt,
      },
    });

    await expect(gate.assertCurrentAcknowledgement(doctor.id)).resolves.toBe(undefined);
    await expect(
      activation.activate(
        doctor.id,
        { practiceLocationId: location.id, currentPassword: 'e2e-not-used' },
        `m12s8-activate-${unique}`,
      ),
    ).resolves.toEqual({ activated: true, replayed: false });

    const [persistedAcknowledgement, activeLocation] = await Promise.all([
      prisma.doctorDataRetentionAcknowledgement.findUniqueOrThrow({
        where: {
          doctorUserId_acknowledgementVersion: {
            doctorUserId: doctor.id,
            acknowledgementVersion: CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
          },
        },
      }),
      prisma.practiceLocation.findUniqueOrThrow({ where: { id: location.id }, select: { lifecycleStatus: true } }),
    ]);

    expect(persistedAcknowledgement.acknowledgedAt.getTime()).toBe(acknowledgedAt.getTime());
    expect(activeLocation.lifecycleStatus).toBe(PracticeLocationLifecycleStatus.ACTIVE);
  });
});