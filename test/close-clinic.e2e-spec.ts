import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicClosureDisposition,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { CloseClinicService } from './../src/queue/close-clinic.service';
import { CloseClinicDto } from './../src/queue/dto/close-clinic.dto';
import {
  NextPatientDto,
  NextPatientOutcome,
} from './../src/queue/dto/next-patient.dto';
import { NextPatientService } from './../src/queue/next-patient.service';
import { ScheduleResolutionService } from './../src/schedule/schedule-resolution.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('CLOSE CLINIC controls (e2e)', () => {
  let prisma: PrismaService;
  let closeClinic: CloseClinicService;
  let nextPatient: NextPatientService;
  let doctorUserId: string;
  let secretaryUserId: string;
  let otherSecretaryUserId: string;
  let practiceLocationId: string;
  let operatingPracticeStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const scheduleTime = new ScheduleTimeService();
    closeClinic = new CloseClinicService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleResolutionService(prisma, scheduleTime),
      scheduleTime,
    );
    nextPatient = new NextPatientService(
      prisma,
      new CommandIdempotencyService(),
      scheduleTime,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-close-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Close',
        lastName: 'Doctor',
        mobileNumber: `0940${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    doctorUserId = doctor.id;

    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Clinic Closure',
        licenseNumber: `M7C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Close ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId,
        weekday: 'MONDAY',
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T00:00:00.000Z'),
        closesAtLocal: new Date('1970-01-01T00:01:00.000Z'),
        maximumOnlineBookingUntilLocal: new Date('1970-01-01T00:01:00.000Z'),
        maximumOperatingUntilLocal: new Date('1970-01-01T00:02:00.000Z'),
      },
    });

    const secretary = await prisma.user.create({
      data: {
        email: `m7-close-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Operating',
        lastName: 'Secretary',
        mobileNumber: `0941${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    secretaryUserId = secretary.id;
    const operating = await prisma.practiceStaff.create({
      data: {
        userId: secretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    operatingPracticeStaffId = operating.id;

    const other = await prisma.user.create({
      data: {
        email: `m7-close-other-${scope.slice(0, 12)}@example.test`,
        firstName: 'Other',
        lastName: 'Secretary',
        mobileNumber: `0942${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    otherSecretaryUserId = other.id;
    await prisma.practiceStaff.create({
      data: {
        userId: other.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ClinicClosureDisposition.COMPLETED,
    ClinicClosureDisposition.OUT_FOR_PROCEDURE,
  ])('closes a started clinic and applies final disposition %s', async (disposition) => {
    const serviceDate = disposition === ClinicClosureDisposition.COMPLETED ? '2026-11-16' : '2026-11-23';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, `CURRENT-${disposition}`, {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const absent = await createAppointment(date, 2, `ABSENT-${disposition}`, {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const procedure = await createAppointment(date, 3, `PROCEDURE-${disposition}`, {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const result = await closeClinic.close(
      doctorUserId,
      closeDto(serviceDate, disposition),
      `close-${disposition}-${scope}`,
    );

    const [clinicDay, currentAfter, absentAfter, procedureAfter, event] = await Promise.all([
      prisma.clinicDay.findUniqueOrThrow({
        where: { practiceLocationId_serviceDate: { practiceLocationId, serviceDate: date } },
      }),
      prisma.appointment.findUniqueOrThrow({ where: { id: current.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: procedure.id } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
    ]);

    expect(clinicDay.status).toBe(ClinicDayStatus.CLOSED);
    expect(clinicDay.closedAt).not.toBeNull();
    expect(event.type).toBe(QueueEventType.QUEUE_CLOSED);
    expect(absentAfter.status).toBe(AppointmentStatus.EXPIRED);
    expect(procedureAfter.status).toBe(AppointmentStatus.EXPIRED);
    expect(absentAfter.activeAppointmentKey).toBeNull();
    expect(procedureAfter.activeAppointmentKey).toBeNull();

    if (disposition === ClinicClosureDisposition.COMPLETED) {
      expect(currentAfter.status).toBe(AppointmentStatus.COMPLETED);
      expect(currentAfter.completedAt).not.toBeNull();
    } else {
      expect(currentAfter.status).toBe(AppointmentStatus.EXPIRED);
      expect(currentAfter.completedAt).toBeNull();
    }
    expect(currentAfter.terminalAt).not.toBeNull();
    expect(currentAfter.activeAppointmentKey).toBeNull();
  });

  it('rejects closure while WAITING Appointments remain', async () => {
    const serviceDate = '2026-11-30';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    await createAppointment(date, 1, 'WAITING-BLOCK', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    await expect(
      closeClinic.close(doctorUserId, closeDto(serviceDate), `waiting-block-${scope}`),
    ).rejects.toThrow('waiting Appointments remain');
  });

  it('replays the same CLOSE CLINIC idempotently', async () => {
    const serviceDate = '2026-12-07';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const key = `close-replay-${scope}`;

    const first = await closeClinic.close(doctorUserId, closeDto(serviceDate), key);
    const replay = await closeClinic.close(doctorUserId, closeDto(serviceDate), key);

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    expect(
      await prisma.queueEvent.count({
        where: { practiceLocationId, serviceDate: date, type: QueueEventType.QUEUE_CLOSED },
      }),
    ).toBe(1);
  });

  it('allows the operating secretary and rejects another assigned secretary', async () => {
    const allowedDate = '2026-12-14';
    await createStartedClinicDay(dateValue(allowedDate));
    await expect(
      closeClinic.close(secretaryUserId, closeDto(allowedDate), `close-secretary-ok-${scope}`),
    ).resolves.toMatchObject({ status: ClinicDayStatus.CLOSED });

    const deniedDate = '2026-12-21';
    await createStartedClinicDay(dateValue(deniedDate));
    await expect(
      closeClinic.close(otherSecretaryUserId, closeDto(deniedDate), `close-secretary-no-${scope}`),
    ).rejects.toThrow('current operating secretary');
  });

  it('serializes CLOSE CLINIC against concurrent NEXT PATIENT mutation', async () => {
    const serviceDate = '2026-12-28';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    await createAppointment(date, 1, 'RACE-CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    await createAppointment(date, 2, 'RACE-NEXT', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    const settled = await Promise.allSettled([
      closeClinic.close(
        doctorUserId,
        closeDto(serviceDate, ClinicClosureDisposition.COMPLETED),
        `close-race-${scope}`,
      ),
      nextPatient.advance(
        doctorUserId,
        nextDto(serviceDate, NextPatientOutcome.COMPLETED),
        `next-race-${scope}`,
      ),
    ]);

    const fulfilled = settled.filter((item) => item.status === 'fulfilled');
    const rejected = settled.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const clinicDay = await prisma.clinicDay.findUniqueOrThrow({
      where: { practiceLocationId_serviceDate: { practiceLocationId, serviceDate: date } },
    });
    const queueClosedEvents = await prisma.queueEvent.count({
      where: { practiceLocationId, serviceDate: date, type: QueueEventType.QUEUE_CLOSED },
    });
    const nextEvents = await prisma.queueEvent.count({
      where: { practiceLocationId, serviceDate: date, type: QueueEventType.NEXT_PATIENT },
    });

    expect(queueClosedEvents + nextEvents).toBe(1);
    expect([ClinicDayStatus.STARTED, ClinicDayStatus.CLOSED]).toContain(clinicDay.status);
  });

  function closeDto(
    serviceDate: string,
    finalPatientDisposition?: ClinicClosureDisposition,
  ): CloseClinicDto {
    return { practiceLocationId, serviceDate, finalPatientDisposition };
  }

  function nextDto(
    serviceDate: string,
    patientOutcome: NextPatientOutcome,
  ): NextPatientDto {
    return { practiceLocationId, serviceDate, patientOutcome };
  }

  async function createStartedClinicDay(serviceDate: Date) {
    const now = new Date();
    return prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate,
        status: ClinicDayStatus.STARTED,
        operatingPracticeStaffId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async function createAppointment(
    serviceDate: Date,
    queueNumber: number,
    discriminator: string,
    overrides: Partial<Prisma.AppointmentUncheckedCreateInput>,
  ) {
    return prisma.appointment.create({
      data: {
        bookingReference: `M7C-${scope.slice(0, 8)}-${serviceDate.toISOString().slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        firstName: 'Close',
        lastName: discriminator,
        ...overrides,
      },
    });
  }

  function dateValue(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
});
