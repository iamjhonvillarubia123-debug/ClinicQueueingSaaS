import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  NextPatientDto,
  NextPatientOutcome,
} from './../src/queue/dto/next-patient.dto';
import { UndoQueueDto } from './../src/queue/dto/undo-queue.dto';
import { NextPatientService } from './../src/queue/next-patient.service';
import { UndoQueueService } from './../src/queue/undo-queue.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

type AppointmentFixtureOverrides = Partial<
  Omit<
    Prisma.AppointmentUncheckedCreateInput,
    | 'bookingReference'
    | 'practiceLocationId'
    | 'serviceDate'
    | 'estimatedServiceMinutes'
    | 'queueNumber'
    | 'activeAppointmentKey'
    | 'firstName'
    | 'lastName'
  >
>;

describe('UNDO queue controls (e2e)', () => {
  let prisma: PrismaService;
  let nextPatient: NextPatientService;
  let undoQueue: UndoQueueService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const idempotency = new CommandIdempotencyService();
    const scheduleTime = new ScheduleTimeService();
    nextPatient = new NextPatientService(prisma, idempotency, scheduleTime);
    undoQueue = new UndoQueueService(prisma, idempotency, scheduleTime);

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-undo-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Undo',
        lastName: 'Doctor',
        mobileNumber: `0960${scope.slice(0, 7)}`,
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
        specialization: 'Undo Queue',
        licenseNumber: `M7U-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Undo ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    NextPatientOutcome.COMPLETED,
    NextPatientOutcome.OUT_FOR_PROCEDURE,
  ])('reverses the latest NEXT PATIENT outcome %s', async (outcome) => {
    const serviceDate = outcome === NextPatientOutcome.COMPLETED ? '2026-11-01' : '2026-11-02';
    const queue = await createClinicDayWithQueue(serviceDate);
    const nextResult = await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate, outcome),
      `undo-source-${outcome}-${scope}`,
    );

    const result = await undoQueue.undo(
      doctorUserId,
      undoDto(serviceDate),
      `undo-command-${outcome}-${scope}`,
    );

    const [primary, secondary, undoEvent, original, command] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: queue.currentId } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: queue.nextId } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: nextResult.queueEventId } }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: CommandType.UNDO,
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          actorUserId: doctorUserId,
        },
      }),
    ]);

    expect(primary.status).toBe(AppointmentStatus.CALLED);
    expect(primary.servingOrderKey).toBeNull();
    expect(primary.waitingPlacementType).toBeNull();
    expect(primary.activeAppointmentKey).not.toBeNull();
    expect(primary.terminalAt).toBeNull();
    expect(primary.completedAt).toBeNull();
    expect(secondary.status).toBe(AppointmentStatus.WAITING);
    expect(secondary.servingOrderKey?.toString()).toBe('1');
    expect(secondary.waitingPlacementType).toBe(WaitingPlacementType.ORDINARY);
    expect(secondary.calledAt).toBeNull();
    expect(undoEvent.type).toBe(QueueEventType.UNDO);
    expect(undoEvent.actorType).toBe(QueueEventActorType.USER);
    expect(undoEvent.reversesQueueEventId).toBe(original.id);
    expect(command.resultQueueEventId).toBe(undoEvent.id);
  });

  it('restores BookingGroup serving protection ended by NEXT PATIENT', async () => {
    const serviceDate = '2026-11-03';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const group = await prisma.bookingGroup.create({
      data: { practiceLocationId, serviceDate: date },
    });
    const current = await createAppointment(date, 1, 'GROUP-CURRENT', {
      bookingGroupId: group.id,
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const next = await createAppointment(date, 2, 'OUTSIDE-GROUP', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate, NextPatientOutcome.COMPLETED),
      `undo-group-source-${scope}`,
    );
    expect(
      (await prisma.bookingGroup.findUniqueOrThrow({ where: { id: group.id } }))
        .servingProtectionEndedAt,
    ).not.toBeNull();

    await undoQueue.undo(
      doctorUserId,
      undoDto(serviceDate),
      `undo-group-${scope}`,
    );

    const [groupAfter, currentAfter, nextAfter] = await Promise.all([
      prisma.bookingGroup.findUniqueOrThrow({ where: { id: group.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: current.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: next.id } }),
    ]);
    expect(groupAfter.servingProtectionEndedAt).toBeNull();
    expect(currentAfter.status).toBe(AppointmentStatus.CALLED);
    expect(nextAfter.status).toBe(AppointmentStatus.WAITING);
  });

  it('replays the same UNDO without writing a second reversal', async () => {
    const serviceDate = '2026-11-04';
    await createClinicDayWithQueue(serviceDate);
    await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate, NextPatientOutcome.COMPLETED),
      `undo-replay-source-${scope}`,
    );
    const key = `undo-replay-${scope}`;
    const first = await undoQueue.undo(doctorUserId, undoDto(serviceDate), key);
    const replay = await undoQueue.undo(doctorUserId, undoDto(serviceDate), key);

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          type: QueueEventType.UNDO,
        },
      }),
    ).toBe(1);
  });

  it('rejects UNDO when a later effective queue event intervened', async () => {
    const serviceDate = '2026-11-05';
    const queue = await createClinicDayWithQueue(serviceDate);
    await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate, NextPatientOutcome.OUT_FOR_PROCEDURE),
      `undo-stale-source-${scope}`,
    );

    const sequence = await nextSequence(dateValue(serviceDate));
    const later = await prisma.queueEvent.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        queueEventSequence: sequence,
        type: QueueEventType.RETURN_TO_QUEUE,
        actorType: QueueEventActorType.USER,
        actorUserId: doctorUserId,
        previousPrimaryStatus: AppointmentStatus.OUT_FOR_PROCEDURE,
        newPrimaryStatus: AppointmentStatus.WAITING,
      },
    });
    await prisma.queueEventAppointmentLink.create({
      data: {
        queueEventId: later.id,
        role: QueueEventAppointmentLinkRole.PRIMARY,
        appointmentId: queue.currentId,
      },
    });

    await expect(
      undoQueue.undo(
        doctorUserId,
        undoDto(serviceDate),
        `undo-stale-${scope}`,
      ),
    ).rejects.toThrow('No eligible queue operation is available to undo');
  });

  it('serializes concurrent UNDO attempts so exactly one reversal commits', async () => {
    const serviceDate = '2026-11-06';
    await createClinicDayWithQueue(serviceDate);
    const source = await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate, NextPatientOutcome.COMPLETED),
      `undo-race-source-${scope}`,
    );

    const settled = await Promise.allSettled([
      undoQueue.undo(
        doctorUserId,
        undoDto(serviceDate),
        `undo-race-a-${scope}`,
      ),
      undoQueue.undo(
        doctorUserId,
        undoDto(serviceDate),
        `undo-race-b-${scope}`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          type: QueueEventType.UNDO,
          reversesQueueEventId: source.queueEventId,
        },
      }),
    ).toBe(1);
  });

  function nextDto(
    serviceDate: string,
    patientOutcome: NextPatientOutcome,
  ): NextPatientDto {
    return { practiceLocationId, serviceDate, patientOutcome };
  }

  function undoDto(serviceDate: string): UndoQueueDto {
    return { practiceLocationId, serviceDate };
  }

  async function createClinicDayWithQueue(serviceDate: string) {
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, 'CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const next = await createAppointment(date, 2, 'NEXT', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    return { currentId: current.id, nextId: next.id };
  }

  async function createStartedClinicDay(serviceDate: Date) {
    const now = new Date();
    return prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate,
        status: ClinicDayStatus.STARTED,
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
    overrides: AppointmentFixtureOverrides,
  ) {
    const mobileNumberHash = createHash('sha256')
      .update(`${scope}|mobile|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`)
      .digest('hex');
    const activeAppointmentKey = createHash('sha256')
      .update(
        `ACTIVE_APPOINTMENT|${mobileNumberHash}|${practiceLocationId}|${serviceDate
          .toISOString()
          .slice(0, 10)}`,
      )
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `M7U-${scope.slice(0, 8)}-${serviceDate.toISOString().slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        mobileNumberHash,
        firstName: 'Patient',
        lastName: discriminator,
        ...overrides,
      },
    });
  }

  async function nextSequence(serviceDate: Date): Promise<bigint> {
    const latest = await prisma.queueEvent.findFirst({
      where: { practiceLocationId, serviceDate },
      select: { queueEventSequence: true },
      orderBy: { queueEventSequence: 'desc' },
    });
    return (latest?.queueEventSequence ?? 0n) + 1n;
  }

  function dateValue(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
});
