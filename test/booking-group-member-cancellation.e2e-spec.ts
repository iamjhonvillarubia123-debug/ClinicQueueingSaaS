import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicDayStatus,
  CommandType,
  NotificationType,
  PracticeLocationLifecycleStatus,
  Prisma,
  QueueEventActorType,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { BookingGroupMemberCancellationService } from './../src/booking/booking-group-member-cancellation.service';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { NextPatientOutcome } from './../src/queue/dto/next-patient.dto';
import { NextPatientService } from './../src/queue/next-patient.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

const DAY_MS = 24 * 60 * 60 * 1000;

type GroupFixture = {
  scope: string;
  serviceDate: string;
  practiceLocationId: string;
  doctorUserId: string;
  bookingGroupId: string;
  controllerToken: string;
  memberIds: string[];
  queueNumbers: number[];
};

describe('BookingGroup member cancellation controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cancellation: BookingGroupMemberCancellationService;
  let nextPatient: NextPatientService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm7s5b-e2e-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 61).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 62).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm7s5b-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm7s5b-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 63).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm7s5b-otp-hmac-v1',
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
    nextPatient = new NextPatientService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
    );
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

  it('cancels exactly one member, preserves Queue Number/group membership, and writes audit/idempotency/notification atomically', async () => {
    const fixture = await createGroupFixture(3);
    const targetId = fixture.memberIds[1]!;
    const expectedQueueNumber = fixture.queueNumbers[1]!;

    const result = await cancellation.cancel(
      fixture.bookingGroupId,
      targetId,
      fixture.controllerToken,
      { reason: 'PATIENT_REQUESTED' },
      `member-cancel-${fixture.scope}`,
    );

    const [appointment, event, command, outbox] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: targetId } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: CommandType.BOOKING_GROUP_CANCEL_MEMBER,
          bookingGroupId: fixture.bookingGroupId,
          appointmentId: targetId,
        },
      }),
      prisma.notificationOutbox.findFirst({
        where: {
          bookingGroupId: fixture.bookingGroupId,
          appointmentId: targetId,
          notificationType: NotificationType.APPOINTMENT_CANCELLATION,
        },
      }),
    ]);

    expect(appointment.status).toBe(AppointmentStatus.CANCELLED);
    expect(appointment.queueNumber).toBe(expectedQueueNumber);
    expect(appointment.bookingGroupId).toBe(fixture.bookingGroupId);
    expect(appointment.servingOrderKey).toBeNull();
    expect(appointment.waitingPlacementType).toBeNull();
    expect(appointment.activeAppointmentKey).toBeNull();
    expect(event.type).toBe(QueueEventType.APPOINTMENT_CANCELLED);
    expect(event.actorType).toBe(QueueEventActorType.PATIENT);
    expect(event.actorUserId).toBeNull();
    expect(command.resultBookingGroupId).toBe(fixture.bookingGroupId);
    expect(command.resultAppointmentId).toBe(targetId);
    expect(command.resultQueueEventId).toBe(result.queueEventId);
    expect(outbox).not.toBeNull();
  });

  it('replays the exact member command and rejects a changed fingerprint', async () => {
    const fixture = await createGroupFixture(2);
    const targetId = fixture.memberIds[0]!;
    const key = `member-replay-${fixture.scope}`;

    const first = await cancellation.cancel(
      fixture.bookingGroupId,
      targetId,
      fixture.controllerToken,
      { reason: 'DUPLICATE_BOOKING' },
      key,
    );
    const replay = await cancellation.cancel(
      fixture.bookingGroupId,
      targetId,
      fixture.controllerToken,
      { reason: 'DUPLICATE_BOOKING' },
      key,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    await expect(
      cancellation.cancel(
        fixture.bookingGroupId,
        targetId,
        fixture.controllerToken,
        { reason: 'CLINIC_REQUESTED' },
        key,
      ),
    ).rejects.toThrow();

    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId: fixture.practiceLocationId,
          serviceDate: dateValue(fixture.serviceDate),
          type: QueueEventType.APPOINTMENT_CANCELLED,
        },
      }),
    ).toBe(1);
  });

  it('rejects invalid, revoked, and expired controller tokens', async () => {
    const invalid = await createGroupFixture(2);
    await expect(
      cancellation.cancel(
        invalid.bookingGroupId,
        invalid.memberIds[0]!,
        'not-the-real-token',
        { reason: 'PATIENT_REQUESTED' },
        `invalid-token-${invalid.scope}`,
      ),
    ).rejects.toThrow('controller access is invalid');

    const revoked = await createGroupFixture(2);
    const revokedToken = await prisma.bookingGroupAccessToken.findFirstOrThrow({
      where: { bookingGroupId: revoked.bookingGroupId },
    });
    await prisma.bookingGroupAccessToken.update({
      where: { id: revokedToken.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      cancellation.cancel(
        revoked.bookingGroupId,
        revoked.memberIds[0]!,
        revoked.controllerToken,
        { reason: 'PATIENT_REQUESTED' },
        `revoked-token-${revoked.scope}`,
      ),
    ).rejects.toThrow('controller access is invalid');

    const expired = await createGroupFixture(2);
    const expiredToken = await prisma.bookingGroupAccessToken.findFirstOrThrow({
      where: { bookingGroupId: expired.bookingGroupId },
    });
    await prisma.bookingGroupAccessToken.update({
      where: { id: expiredToken.id },
      data: { expiresAt: new Date(Date.now() - DAY_MS) },
    });
    await expect(
      cancellation.cancel(
        expired.bookingGroupId,
        expired.memberIds[0]!,
        expired.controllerToken,
        { reason: 'PATIENT_REQUESTED' },
        `expired-token-${expired.scope}`,
      ),
    ).rejects.toThrow('controller access is invalid');
  });

  it('ends active group protection when cancellation breaks the remaining protected block and never revives it', async () => {
    const fixture = await createGroupFixture(3);
    const [firstId, secondId, thirdId] = fixture.memberIds;
    const now = new Date();

    await prisma.appointment.update({
      where: { id: firstId! },
      data: {
        status: AppointmentStatus.CALLED,
        calledAt: now,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    });
    await prisma.appointment.update({
      where: { id: secondId! },
      data: {
        servingOrderKey: new Prisma.Decimal(1),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
      },
    });
    await prisma.appointment.update({
      where: { id: thirdId! },
      data: {
        servingOrderKey: new Prisma.Decimal(2),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
      },
    });

    const result = await cancellation.cancel(
      fixture.bookingGroupId,
      secondId!,
      fixture.controllerToken,
      { reason: 'PATIENT_REQUESTED' },
      `protection-end-${fixture.scope}`,
    );
    expect(result.groupProtectionEnded).toBe(true);

    const ended = await prisma.bookingGroup.findUniqueOrThrow({
      where: { id: fixture.bookingGroupId },
    });
    expect(ended.servingProtectionEndedAt).not.toBeNull();
    const endedAt = ended.servingProtectionEndedAt;

    await cancellation.cancel(
      fixture.bookingGroupId,
      thirdId!,
      fixture.controllerToken,
      { reason: 'PATIENT_REQUESTED' },
      `protection-no-revive-${fixture.scope}`,
    );

    const after = await prisma.bookingGroup.findUniqueOrThrow({
      where: { id: fixture.bookingGroupId },
    });
    expect(after.servingProtectionEndedAt?.getTime()).toBe(endedAt?.getTime());
  });

  it('serializes controller cancellation versus NEXT PATIENT without stale contradictory queue state', async () => {
    const fixture = await createGroupFixture(3);
    const [currentId, targetId, fallbackId] = fixture.memberIds;
    const now = new Date();

    await prisma.clinicDay.create({
      data: {
        practiceLocationId: fixture.practiceLocationId,
        serviceDate: dateValue(fixture.serviceDate),
        status: ClinicDayStatus.STARTED,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.appointment.update({
      where: { id: currentId! },
      data: {
        status: AppointmentStatus.CALLED,
        calledAt: now,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    });
    await prisma.appointment.update({
      where: { id: targetId! },
      data: {
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(1),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
      },
    });
    await prisma.appointment.update({
      where: { id: fallbackId! },
      data: {
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(2),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
      },
    });

    const [nextResult, cancelResult] = await Promise.allSettled([
      nextPatient.advance(
        fixture.doctorUserId,
        {
          practiceLocationId: fixture.practiceLocationId,
          serviceDate: fixture.serviceDate,
          patientOutcome: NextPatientOutcome.COMPLETED,
        },
        `group-race-next-${fixture.scope}`,
      ),
      cancellation.cancel(
        fixture.bookingGroupId,
        targetId!,
        fixture.controllerToken,
        { reason: 'PATIENT_REQUESTED' },
        `group-race-cancel-${fixture.scope}`,
      ),
    ]);

    expect(cancelResult.status).toBe('fulfilled');
    const target = await prisma.appointment.findUniqueOrThrow({
      where: { id: targetId! },
    });
    expect(target.status).toBe(AppointmentStatus.CANCELLED);
    expect(target.servingOrderKey).toBeNull();

    if (nextResult.status === 'fulfilled') {
      const current = await prisma.appointment.findUniqueOrThrow({
        where: { id: currentId! },
      });
      const fallback = await prisma.appointment.findUniqueOrThrow({
        where: { id: fallbackId! },
      });
      expect(current.status).toBe(AppointmentStatus.COMPLETED);
      expect(fallback.status).toBe(AppointmentStatus.CALLED);
    } else {
      const current = await prisma.appointment.findUniqueOrThrow({
        where: { id: currentId! },
      });
      expect(current.status).toBe(AppointmentStatus.CALLED);
    }
  });

  async function createGroupFixture(memberCount: number): Promise<GroupFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);

    const doctor = await prisma.user.create({
      data: {
        email: `m7s5b-${scope.slice(0, 12)}@example.test`,
        firstName: 'Group',
        lastName: 'Doctor',
        mobileNumber: `0918${scope.slice(0, 7)}`,
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
        specialization: 'Group Cancellation',
        licenseNumber: `M7GC-${scope.slice(0, 10)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Group Cancel ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        controllingMobileNumberEncrypted: 'controller-mobile-encrypted',
        controllingMobileNumberHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        controllingMobileLastFour: '1234',
      },
    });
    const token = await moduleToken(group.id, serviceDate);
    const appointments = [];
    for (let index = 0; index < memberCount; index += 1) {
      appointments.push(
        await prisma.appointment.create({
          data: {
            bookingReference: `M7GC-${scope.slice(0, 8)}-${index + 1}`,
            practiceLocationId: location.id,
            bookingGroupId: group.id,
            serviceDate,
            estimatedServiceMinutes: 30,
            queueNumber: index + 1,
            status: AppointmentStatus.WAITING,
            servingOrderKey: new Prisma.Decimal(index + 1),
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: `Member${index + 1}`,
            lastName: 'Group',
            activeAppointmentKey: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
          },
        }),
      );
    }

    return {
      scope,
      serviceDate: serviceDate.toISOString().slice(0, 10),
      practiceLocationId: location.id,
      doctorUserId: doctor.id,
      bookingGroupId: group.id,
      controllerToken: token.rawToken,
      memberIds: appointments.map((item) => item.id),
      queueNumbers: appointments.map((item) => item.queueNumber),
    };
  }

  async function moduleToken(bookingGroupId: string, serviceDate: Date) {
    const issuer = app.get('BookingGroupAccessTokenIssuerService' as never) as never;
    void issuer;
    const rawToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const tokenHash = createHashValue(rawToken);
    await prisma.bookingGroupAccessToken.create({
      data: {
        bookingGroupId,
        tokenHash,
        purpose: 'CONTROLLER_ACCESS',
        expiresAt: new Date(serviceDate.getTime() + 7 * DAY_MS),
      },
    });
    return { rawToken };
  }
});

function createHashValue(value: string): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
