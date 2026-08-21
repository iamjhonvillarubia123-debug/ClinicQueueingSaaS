import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  AppointmentStatus,
  PrivacyErasureResourceType,
  RetentionHoldReasonCategory,
  RetentionResourceType,
} from '../generated/prisma/client';
import { AppModule } from '../src/app.module';
import { AppointmentErasureService } from '../src/privacy-retention/appointment-erasure.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Appointment physical erasure (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let erasureService: AppointmentErasureService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm12-erasure-e2e-only-jwt-secret-not-for-production',
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
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await dropDeleteFailureTrigger();
    if (app) await app.close();

    for (const [key, originalValue] of Object.entries(originalEnvironment)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  async function createFixture(status: AppointmentStatus) {
    const unique = randomUUID();
    const doctor = await prisma.user.create({
      data: {
        email: `m12-erasure-${unique}@example.test`,
        firstName: 'Privacy',
        lastName: 'Doctor',
        mobileNumber: `09${unique.replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-m12-erasure-e2e',
        role: 'DOCTOR',
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `M12-LIC-${unique}`,
            isProfilePublic: true,
          },
        },
      },
      include: { doctorProfile: true },
    });

    if (!doctor.doctorProfile) {
      throw new Error('M12 erasure fixture did not create DoctorProfile.');
    }

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'Privacy Test Clinic',
        addressLine1: '1 Privacy Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const serviceDate = new Date('2026-08-20T00:00:00.000Z');
    const terminalAt = new Date('2026-08-20T00:00:00.000Z');
    const appointment = await prisma.appointment.create({
      data: {
        bookingReference: `M12-${unique}`,
        practiceLocationId: location.id,
        serviceDate,
        estimatedServiceMinutes: 15,
        queueNumber: 1,
        status,
        terminalAt,
        firstName: 'Erase',
        lastName: 'Me',
        mobileNumberEncrypted: 'protected-mobile',
        mobileNumberHash: `hash-${unique}`,
        mobileNumberLastFour: '1234',
      },
    });

    const queueEvent = await prisma.queueEvent.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        queueEventSequence: BigInt(1),
        type: 'CANCEL_APPOINTMENT',
        actorType: 'SYSTEM',
        previousPrimaryStatus: AppointmentStatus.WAITING,
        newPrimaryStatus: status,
        createdAt: terminalAt,
        appointmentLinks: {
          create: {
            role: 'PRIMARY',
            appointmentId: appointment.id,
          },
        },
      },
    });

    return { appointment, location, queueEvent, serviceDate, terminalAt };
  }

  async function installDeleteFailureTrigger(appointmentId: string) {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION m12_test_reject_appointment_delete()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${appointmentId}' THEN
          RAISE EXCEPTION 'M12 forced delete rollback';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS m12_test_reject_appointment_delete_trigger
      ON "Appointment";
      CREATE TRIGGER m12_test_reject_appointment_delete_trigger
      BEFORE DELETE ON "Appointment"
      FOR EACH ROW EXECUTE FUNCTION m12_test_reject_appointment_delete();
    `);
  }

  async function dropDeleteFailureTrigger() {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS m12_test_reject_appointment_delete_trigger
      ON "Appointment";
    `);
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS m12_test_reject_appointment_delete();',
    );
  }

  it('physically deletes an eligible Appointment while preserving QueueEvent and exactly-once analytics', async () => {
    const fixture = await createFixture(AppointmentStatus.COMPLETED);
    const now = new Date('2026-08-21T00:00:00.000Z');

    await expect(
      erasureService.eraseEligibleAppointment(fixture.appointment.id, now),
    ).resolves.toEqual(
      expect.objectContaining({
        appointmentId: fixture.appointment.id,
        outcome: 'ERASED',
      }),
    );

    expect(
      await prisma.appointment.findUnique({
        where: { id: fixture.appointment.id },
      }),
    ).toBeNull();

    const ledger = await prisma.privacyErasureLedger.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: PrivacyErasureResourceType.APPOINTMENT,
          resourceId: fixture.appointment.id,
        },
      },
    });
    expect(ledger).not.toBeNull();

    const analytics = await prisma.queueAnalyticsDaily.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: fixture.location.id,
          serviceDate: fixture.serviceDate,
        },
      },
    });
    expect(analytics.bookedCount).toBe(1);
    expect(analytics.servedCount).toBe(1);

    expect(
      await prisma.queueEvent.findUnique({ where: { id: fixture.queueEvent.id } }),
    ).not.toBeNull();
    expect(
      await prisma.queueEventAppointmentLink.count({
        where: { appointmentId: fixture.appointment.id },
      }),
    ).toBe(0);

    await expect(
      erasureService.eraseEligibleAppointment(fixture.appointment.id, now),
    ).resolves.toEqual(
      expect.objectContaining({ outcome: 'ALREADY_ERASED' }),
    );

    const analyticsAfterReplay = await prisma.queueAnalyticsDaily.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: fixture.location.id,
          serviceDate: fixture.serviceDate,
        },
      },
    });
    expect(analyticsAfterReplay.bookedCount).toBe(1);
    expect(analyticsAfterReplay.servedCount).toBe(1);
  });

  it('blocks erasure while an active RetentionHold exists', async () => {
    const fixture = await createFixture(AppointmentStatus.CANCELLED);
    const now = new Date('2026-08-21T00:00:00.000Z');
    const admin = await prisma.user.create({
      data: {
        email: `m12-admin-${randomUUID()}@example.test`,
        firstName: 'System',
        lastName: 'Admin',
        mobileNumber: `09${randomUUID().replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-m12-erasure-e2e',
        role: 'SYSTEM_ADMIN',
      },
    });

    await prisma.retentionHold.create({
      data: {
        resourceType: RetentionResourceType.APPOINTMENT,
        resourceId: fixture.appointment.id,
        reasonCategory: RetentionHoldReasonCategory.LEGAL_REQUIREMENT,
        explanation: 'Minimum legal preservation hold',
        createdByUserId: admin.id,
        createdAt: now,
        reviewAt: new Date('2026-08-22T00:00:00.000Z'),
        expiresAt: new Date('2026-08-23T00:00:00.000Z'),
      },
    });

    await expect(
      erasureService.eraseEligibleAppointment(fixture.appointment.id, now),
    ).rejects.toThrow('Appointment is protected by an active retention hold.');

    expect(
      await prisma.appointment.findUnique({
        where: { id: fixture.appointment.id },
      }),
    ).not.toBeNull();
    expect(
      await prisma.privacyErasureLedger.count({
        where: {
          resourceType: PrivacyErasureResourceType.APPOINTMENT,
          resourceId: fixture.appointment.id,
        },
      }),
    ).toBe(0);
  });

  it('rolls back analytics and ledger when physical deletion fails', async () => {
    const fixture = await createFixture(AppointmentStatus.NO_SHOW);
    const now = new Date('2026-08-21T00:00:00.000Z');
    await installDeleteFailureTrigger(fixture.appointment.id);

    try {
      await expect(
        erasureService.eraseEligibleAppointment(fixture.appointment.id, now),
      ).rejects.toThrow('M12 forced delete rollback');
    } finally {
      await dropDeleteFailureTrigger();
    }

    expect(
      await prisma.appointment.findUnique({
        where: { id: fixture.appointment.id },
      }),
    ).not.toBeNull();
    expect(
      await prisma.privacyErasureLedger.count({
        where: {
          resourceType: PrivacyErasureResourceType.APPOINTMENT,
          resourceId: fixture.appointment.id,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.queueAnalyticsDaily.count({
        where: {
          practiceLocationId: fixture.location.id,
          serviceDate: fixture.serviceDate,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.queueEventAppointmentLink.count({
        where: { appointmentId: fixture.appointment.id },
      }),
    ).toBe(1);
  });
});
