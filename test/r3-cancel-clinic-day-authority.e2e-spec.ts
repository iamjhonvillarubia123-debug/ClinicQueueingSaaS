import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentCancelledByType,
  AppointmentStatus,
  ClinicDayCancellationReason,
  ClinicDayStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  PracticeStaffCapabilityStatus,
  PracticeStaffCapabilityType,
  PracticeStaffRole,
  Prisma,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { PasswordSecurityService } from './../src/auth/security/password-security.service';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { CancelClinicDayService } from './../src/queue/cancel-clinic-day.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

const TEST_PASSWORD = 'ClinicCancel!2026Secure';

describe('R3 clinic day cancellation authority (e2e)', () => {
  let prisma: PrismaService;
  let service: CancelClinicDayService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let noCapabilitySecretaryUserId: string;
  let noCapabilityPracticeStaffId: string;
  let capableSecretaryUserId: string;
  let capablePracticeStaffId: string;
  let passwordHash: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const passwords = new PasswordSecurityService();
    passwordHash = await passwords.hashStrong(TEST_PASSWORD);
    const config = new ConfigService({
      MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 11).toString('base64'),
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-clinic-day-cancel-key',
    });
    service = new CancelClinicDayService(
      prisma,
      new CommandIdempotencyService(),
      passwords,
      new NotificationPayloadService(config),
      new ScheduleTimeService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await createUser('doctor', UserRole.DOCTOR, '0980');
    doctorUserId = doctor.id;
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Cancellation Authority',
        licenseNumber: `R3CDC-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Clinic Cancel ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const noCapability = await createSecretary('nocap', '0981');
    noCapabilitySecretaryUserId = noCapability.userId;
    noCapabilityPracticeStaffId = noCapability.practiceStaffId;

    const capable = await createSecretary('capable', '0982');
    capableSecretaryUserId = capable.userId;
    capablePracticeStaffId = capable.practiceStaffId;
    await grantCancelCapability(capablePracticeStaffId);
  });

  afterAll(async () => prisma.$disconnect());

  it('owning Doctor cancels a started clinic day, resolves active Appointments, preserves terminal Appointments and replays once', async () => {
    const serviceDate = '2027-02-01';
    await createClinicDay(serviceDate, ClinicDayStatus.STARTED);
    const waiting = await createAppointment(
      serviceDate,
      1,
      AppointmentStatus.WAITING,
    );
    const called = await createAppointment(
      serviceDate,
      2,
      AppointmentStatus.CALLED,
    );
    const absent = await createAppointment(
      serviceDate,
      3,
      AppointmentStatus.TEMPORARILY_ABSENT,
    );
    const procedure = await createAppointment(
      serviceDate,
      4,
      AppointmentStatus.OUT_FOR_PROCEDURE,
    );
    const completed = await createAppointment(
      serviceDate,
      5,
      AppointmentStatus.COMPLETED,
    );

    const dto = {
      practiceLocationId,
      serviceDate,
      reason: ClinicDayCancellationReason.DOCTOR_UNAVAILABLE,
      acknowledgedServiceDate: serviceDate,
      password: TEST_PASSWORD,
    };
    const key = `doctor-day-cancel-${scope}`;
    const result = await service.cancel(doctorUserId, dto, key);
    expect(result).toMatchObject({
      replayed: false,
      status: ClinicDayStatus.CANCELLED,
      cancelledAppointmentCount: 4,
    });

    const [day, activeAfter, completedAfter, eventCount, commandCount] =
      await Promise.all([
        prisma.clinicDay.findUniqueOrThrow({
          where: {
            practiceLocationId_serviceDate: {
              practiceLocationId,
              serviceDate: dateValue(serviceDate),
            },
          },
        }),
        prisma.appointment.findMany({
          where: { id: { in: [waiting.id, called.id, absent.id, procedure.id] } },
          orderBy: { queueNumber: 'asc' },
        }),
        prisma.appointment.findUniqueOrThrow({ where: { id: completed.id } }),
        prisma.queueEvent.count({
          where: {
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
            type: QueueEventType.APPOINTMENT_CANCELLED,
          },
        }),
        prisma.commandIdempotency.count({
          where: {
            commandType: 'CANCEL_CLINIC_DAY',
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
            actorUserId: doctorUserId,
          },
        }),
      ]);

    expect(day.status).toBe(ClinicDayStatus.CANCELLED);
    expect(day.cancelledByUserId).toBe(doctorUserId);
    expect(day.cancellationReason).toBe(
      ClinicDayCancellationReason.DOCTOR_UNAVAILABLE,
    );
    expect(activeAfter.map((item) => item.status)).toEqual([
      AppointmentStatus.CANCELLED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.CANCELLED,
    ]);
    expect(activeAfter.map((item) => item.queueNumber)).toEqual([1, 2, 3, 4]);
    expect(
      activeAfter.every(
        (item) =>
          item.cancelledByType === AppointmentCancelledByType.DOCTOR &&
          item.activeAppointmentKey === null &&
          item.terminalAt !== null,
      ),
    ).toBe(true);
    expect(completedAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(eventCount).toBe(4);
    expect(commandCount).toBe(1);

    const replay = await service.cancel(doctorUserId, dto, key);
    expect(replay.replayed).toBe(true);
    expect(replay.clinicDayId).toBe(result.clinicDayId);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          type: QueueEventType.APPOINTMENT_CANCELLED,
        },
      }),
    ).toBe(4);
  });

  it('rejects Doctor cancellation when password re-authentication fails', async () => {
    const serviceDate = '2027-02-02';
    await createClinicDay(serviceDate, ClinicDayStatus.NOT_STARTED);
    await expect(
      service.cancel(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          reason: ClinicDayCancellationReason.SCHEDULE_CONFLICT,
          acknowledgedServiceDate: serviceDate,
          password: 'WrongPassword!2026',
        },
        `doctor-wrong-password-${scope}`,
      ),
    ).rejects.toThrow('Password re-authentication failed.');
    expect((await readClinicDay(serviceDate)).status).toBe(
      ClinicDayStatus.NOT_STARTED,
    );
  });

  it('denies an operating Secretary without CANCEL CLINIC DAY capability', async () => {
    const serviceDate = '2027-02-03';
    await createClinicDay(
      serviceDate,
      ClinicDayStatus.STARTED,
      noCapabilityPracticeStaffId,
    );
    await expect(
      service.cancel(
        noCapabilitySecretaryUserId,
        {
          practiceLocationId,
          serviceDate,
          reason: ClinicDayCancellationReason.CLINIC_UNAVAILABLE,
          acknowledgedServiceDate: serviceDate,
          password: TEST_PASSWORD,
        },
        `secretary-no-cap-${scope}`,
      ),
    ).rejects.toThrow('Secretary lacks CANCEL CLINIC DAY capability.');
    expect((await readClinicDay(serviceDate)).status).toBe(
      ClinicDayStatus.STARTED,
    );
  });

  it('allows a capable non-operating Secretary to cancel a NOT_STARTED clinic day', async () => {
    const serviceDate = '2027-02-04';
    await createClinicDay(
      serviceDate,
      ClinicDayStatus.NOT_STARTED,
      noCapabilityPracticeStaffId,
    );
    const appointment = await createAppointment(
      serviceDate,
      21,
      AppointmentStatus.WAITING,
    );
    await expect(
      service.cancel(
        capableSecretaryUserId,
        {
          practiceLocationId,
          serviceDate,
          reason: ClinicDayCancellationReason.PERSONAL_EMERGENCY,
          acknowledgedServiceDate: serviceDate,
          password: TEST_PASSWORD,
        },
        `secretary-capable-${scope}`,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      status: ClinicDayStatus.CANCELLED,
    });
    const [day, after] = await Promise.all([
      readClinicDay(serviceDate),
      prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
    ]);
    expect(day.cancelledByUserId).toBe(capableSecretaryUserId);
    expect(after.cancelledByType).toBe(AppointmentCancelledByType.SECRETARY);
  });

  it('supports pre-start cancellation before a ClinicDay row exists', async () => {
    const serviceDate = '2027-02-05';
    expect(
      await prisma.clinicDay.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        },
      }),
    ).toBeNull();
    await expect(
      service.cancel(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          reason: ClinicDayCancellationReason.DOCTOR_UNAVAILABLE,
          acknowledgedServiceDate: serviceDate,
          password: TEST_PASSWORD,
        },
        `doctor-prestart-${scope}`,
      ),
    ).resolves.toMatchObject({ status: ClinicDayStatus.CANCELLED });
    expect((await readClinicDay(serviceDate)).status).toBe(
      ClinicDayStatus.CANCELLED,
    );
  });

  it('rejects exact-date acknowledgement mismatch and terminal ClinicDay cancellation', async () => {
    const mismatchDate = '2027-02-06';
    await createClinicDay(mismatchDate, ClinicDayStatus.NOT_STARTED);
    await expect(
      service.cancel(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate: mismatchDate,
          reason: ClinicDayCancellationReason.OTHER,
          note: 'Unexpected facility issue',
          acknowledgedServiceDate: '2027-02-07',
          password: TEST_PASSWORD,
        },
        `doctor-date-mismatch-${scope}`,
      ),
    ).rejects.toThrow('acknowledgement must match the exact Service Date');

    const terminalDate = '2027-02-07';
    await createClinicDay(terminalDate, ClinicDayStatus.NOT_STARTED);
    await service.cancel(
      doctorUserId,
      {
        practiceLocationId,
        serviceDate: terminalDate,
        reason: ClinicDayCancellationReason.CLINIC_UNAVAILABLE,
        acknowledgedServiceDate: terminalDate,
        password: TEST_PASSWORD,
      },
      `doctor-terminal-setup-${scope}`,
    );
    expect((await readClinicDay(terminalDate)).status).toBe(
      ClinicDayStatus.CANCELLED,
    );
    await expect(
      service.cancel(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate: terminalDate,
          reason: ClinicDayCancellationReason.OTHER,
          note: 'Should not apply',
          acknowledgedServiceDate: terminalDate,
          password: TEST_PASSWORD,
        },
        `doctor-terminal-retry-${scope}`,
      ),
    ).rejects.toThrow('not eligible for cancellation');
  });

  async function createUser(label: string, role: UserRole, prefix: string) {
    return prisma.user.create({
      data: {
        email: `r3-clinic-cancel-${label}-${scope?.slice(0, 10) ?? randomUUID().slice(0, 8)}@example.test`,
        firstName: label,
        lastName: 'User',
        mobileNumber: `${prefix}${randomUUID().replaceAll('-', '').slice(0, 7)}`,
        passwordHash,
        role,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
  }

  async function createSecretary(label: string, prefix: string) {
    const user = await createUser(label, UserRole.SECRETARY, prefix);
    const staff = await prisma.practiceStaff.create({
      data: {
        userId: user.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    return { userId: user.id, practiceStaffId: staff.id };
  }

  async function grantCancelCapability(practiceStaffId: string) {
    const now = new Date();
    return prisma.practiceStaffCapability.create({
      data: {
        practiceStaffId,
        capabilityType: PracticeStaffCapabilityType.CANCEL_CLINIC_DAY,
        status: PracticeStaffCapabilityStatus.ACTIVE,
        activeCapabilityKey: createHash('sha256')
          .update(`${practiceStaffId}|CANCEL_CLINIC_DAY`)
          .digest('hex'),
        grantedByUserId: doctorUserId,
        grantedAt: now,
        createdAt: now,
      },
    });
  }

  async function createClinicDay(
    serviceDate: string,
    status: ClinicDayStatus,
    operatingPracticeStaffId: string | null = null,
  ) {
    const now = new Date();
    return prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        status,
        operatingPracticeStaffId,
        startedAt: status === ClinicDayStatus.STARTED ? now : null,
        closedAt: status === ClinicDayStatus.CLOSED ? now : null,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async function createAppointment(
    serviceDate: string,
    queueNumber: number,
    status: AppointmentStatus,
  ) {
    const now = new Date();
    const isTerminal =
      status === AppointmentStatus.COMPLETED ||
      status === AppointmentStatus.CANCELLED ||
      status === AppointmentStatus.EXPIRED ||
      status === AppointmentStatus.NO_SHOW ||
      status === AppointmentStatus.RESCHEDULED;
    const inWaitingQueue = status === AppointmentStatus.WAITING;
    return prisma.appointment.create({
      data: {
        bookingReference: `R3CDC-${scope.slice(0, 8)}-${queueNumber}-${serviceDate}`,
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        estimatedServiceMinutes: 30,
        queueNumber,
        firstName: 'Clinic',
        lastName: `Cancel${queueNumber}`,
        status,
        servingOrderKey: inWaitingQueue ? new Prisma.Decimal(queueNumber) : null,
        waitingPlacementType: inWaitingQueue
          ? WaitingPlacementType.ORDINARY
          : null,
        activeAppointmentKey: isTerminal
          ? null
          : createHash('sha256')
              .update(`${scope}|${serviceDate}|${queueNumber}|active`)
              .digest('hex'),
        calledAt: status === AppointmentStatus.CALLED ? now : null,
        completedAt: status === AppointmentStatus.COMPLETED ? now : null,
        terminalAt: isTerminal ? now : null,
      },
    });
  }

  function readClinicDay(serviceDate: string) {
    return prisma.clinicDay.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
        },
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
