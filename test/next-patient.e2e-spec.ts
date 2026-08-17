import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
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
import { NextPatientService } from './../src/queue/next-patient.service';
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

describe('NEXT PATIENT controls (e2e)', () => {
  let prisma: PrismaService;
  let service: NextPatientService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let operatingSecretaryUserId: string;
  let operatingPracticeStaffId: string;
  let otherSecretaryUserId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new NextPatientService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-next-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Next',
        lastName: 'Doctor',
        mobileNumber: `0920${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    doctorUserId = doctor.id;

    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Queue Progression',
        licenseNumber: `M7N-${scope.slice(0, 12)}`,
      },
    });

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Next ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `m7-next-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Operating',
        lastName: 'Secretary',
        mobileNumber: `0921${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    operatingSecretaryUserId = secretary.id;

    const operatingAssignment = await prisma.practiceStaff.create({
      data: {
        userId: secretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    operatingPracticeStaffId = operatingAssignment.id;

    const otherSecretary = await prisma.user.create({
      data: {
        email: `m7-next-other-${scope.slice(0, 12)}@example.test`,
        firstName: 'Other',
        lastName: 'Secretary',
        mobileNumber: `0922${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    otherSecretaryUserId = otherSecretary.id;

    await prisma.practiceStaff.create({
      data: {
        userId: otherSecretary.id,
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
    [NextPatientOutcome.NOW_SERVING, AppointmentStatus.TEMPORARILY_ABSENT],
    [NextPatientOutcome.COMPLETED, AppointmentStatus.COMPLETED],
    [NextPatientOutcome.OUT_FOR_PROCEDURE, AppointmentStatus.OUT_FOR_PROCEDURE],
  ])('applies %s and calls the next waiting Appointment atomically', async (patientOutcome, expectedCurrentStatus) => {
    const serviceDate = uniqueServiceDate(patientOutcome);
    const current = await createClinicDayWithQueue(serviceDate);

    const result = await service.advance(
      doctorUserId,
      dto(serviceDate, patientOutcome),
      `outcome-${patientOutcome}-${scope}`,
    );

    const [currentAfter, nextAfter, event, links, command] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: current.currentId } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: current.nextId } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.queueEventAppointmentLink.findMany({
        where: { queueEventId: result.queueEventId },
        orderBy: { role: 'asc' },
      }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: 'NEXT_PATIENT',
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          actorUserId: doctorUserId,
        },
      }),
    ]);

    expect(currentAfter.status).toBe(expectedCurrentStatus);
    expect(nextAfter.status).toBe(AppointmentStatus.CALLED);
    expect(nextAfter.calledAt).not.toBeNull();
    expect(nextAfter.servingOrderKey).toBeNull();
    expect(nextAfter.waitingPlacementType).toBeNull();
    expect(event.type).toBe('NEXT_PATIENT');
    expect(event.newPrimaryStatus).toBe(expectedCurrentStatus);
    expect(event.newSecondaryStatus).toBe(AppointmentStatus.CALLED);
    expect(links).toHaveLength(2);
    expect(command.resultQueueEventId).toBe(result.queueEventId);
    expect(command.resultAppointmentId).toBeNull();

    if (expectedCurrentStatus === AppointmentStatus.COMPLETED) {
      expect(currentAfter.completedAt).not.toBeNull();
      expect(currentAfter.terminalAt).not.toBeNull();
      expect(currentAfter.activeAppointmentKey).toBeNull();
    } else {
      expect(currentAfter.completedAt).toBeNull();
      expect(currentAfter.terminalAt).toBeNull();
      expect(currentAfter.activeAppointmentKey).not.toBeNull();
    }
  });

  it('replays the same command without advancing again', async () => {
    const serviceDate = '2026-09-04';
    const queue = await createClinicDayWithQueue(serviceDate, 3);

    const first = await service.advance(
      doctorUserId,
      dto(serviceDate, NextPatientOutcome.COMPLETED),
      `replay-${scope}`,
    );
    const replay = await service.advance(
      doctorUserId,
      dto(serviceDate, NextPatientOutcome.COMPLETED),
      `replay-${scope}`,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    expect(replay.previousCalledAppointmentId).toBe(queue.currentId);
    expect(replay.calledAppointmentId).toBe(queue.nextId);

    const [events, commands, remaining] = await Promise.all([
      prisma.queueEvent.findMany({
        where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
      }),
      prisma.commandIdempotency.findMany({
        where: {
          commandType: 'NEXT_PATIENT',
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
        },
      }),
      prisma.appointment.findUniqueOrThrow({ where: { id: queue.thirdId! } }),
    ]);

    expect(events).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(remaining.status).toBe(AppointmentStatus.WAITING);
  });

  it('rejects NEXT PATIENT when no eligible next waiting Appointment exists', async () => {
    const serviceDate = '2026-09-05';
    await createClinicDayWithQueue(serviceDate, 1);

    await expect(
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        `no-next-${scope}`,
      ),
    ).rejects.toThrow('no eligible waiting Appointment exists');

    expect(
      await prisma.queueEvent.count({
        where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
      }),
    ).toBe(0);
  });

  it('selects the smallest authoritative servingOrderKey, not the smallest Queue Number', async () => {
    const serviceDate = '2026-09-06';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, 'CURRENT-ORDER', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const higherQueueEarlierOrder = await createAppointment(date, 9, 'ORDER-1', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('1.25'),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    await createAppointment(date, 2, 'ORDER-2', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('2.00'),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    const result = await service.advance(
      doctorUserId,
      dto(serviceDate, NextPatientOutcome.COMPLETED),
      `order-${scope}`,
    );

    expect(result.previousCalledAppointmentId).toBe(current.id);
    expect(result.calledAppointmentId).toBe(higherQueueEarlierOrder.id);
  });

  it('allows the operating secretary and rejects another assigned secretary', async () => {
    const allowedDate = '2026-09-07';
    await createClinicDayWithQueue(allowedDate);
    await expect(
      service.advance(
        operatingSecretaryUserId,
        dto(allowedDate, NextPatientOutcome.COMPLETED),
        `secretary-ok-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });

    const deniedDate = '2026-09-08';
    await createClinicDayWithQueue(deniedDate);
    await expect(
      service.advance(
        otherSecretaryUserId,
        dto(deniedDate, NextPatientOutcome.COMPLETED),
        `secretary-no-${scope}`,
      ),
    ).rejects.toThrow('current operating secretary');
  });

  it('serializes concurrent distinct NEXT PATIENT commands so only one advances the queue', async () => {
    const serviceDate = '2026-09-09';
    const queue = await createClinicDayWithQueue(serviceDate, 3);

    const settled = await Promise.allSettled([
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        `race-a-${scope}`,
      ),
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        `race-b-${scope}`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );

    const [events, commands, firstAfter, secondAfter, thirdAfter] =
      await Promise.all([
        prisma.queueEvent.findMany({
          where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            commandType: 'NEXT_PATIENT',
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.currentId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.nextId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.thirdId! } }),
      ]);

    expect(events).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(firstAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(secondAfter.status).toBe(AppointmentStatus.CALLED);
    expect(thirdAfter.status).toBe(AppointmentStatus.WAITING);
  });

  it('ends group serving protection when NEXT PATIENT leaves the group', async () => {
    const serviceDate = '2026-09-10';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const group = await prisma.bookingGroup.create({
      data: { practiceLocationId, serviceDate: date },
    });
    await createAppointment(date, 1, 'GROUP-CURRENT', {
      bookingGroupId: group.id,
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const next = await createAppointment(date, 2, 'OUTSIDE-GROUP', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    const result = await service.advance(
      doctorUserId,
      dto(serviceDate, NextPatientOutcome.COMPLETED),
      `group-end-${scope}`,
    );
    const groupAfter = await prisma.bookingGroup.findUniqueOrThrow({
      where: { id: group.id },
    });

    expect(result.calledAppointmentId).toBe(next.id);
    expect(result.groupProtectionEnded).toBe(true);
    expect(groupAfter.servingProtectionEndedAt).not.toBeNull();
  });

  function dto(
    serviceDate: string,
    patientOutcome: NextPatientOutcome,
  ): NextPatientDto {
    return { practiceLocationId, serviceDate, patientOutcome };
  }

  async function createClinicDayWithQueue(serviceDate: string, count = 2) {
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, 'CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const next = count >= 2
      ? await createAppointment(date, 2, 'NEXT', {
          status: AppointmentStatus.WAITING,
          servingOrderKey: new Prisma.Decimal(1),
          waitingPlacementType: WaitingPlacementType.ORDINARY,
        })
      : null;
    const third = count >= 3
      ? await createAppointment(date, 3, 'THIRD', {
          status: AppointmentStatus.WAITING,
          servingOrderKey: new Prisma.Decimal(2),
          waitingPlacementType: WaitingPlacementType.ORDINARY,
        })
      : null;
    return {
      currentId: current.id,
      nextId: next?.id ?? '',
      thirdId: third?.id ?? null,
    };
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
    overrides: AppointmentFixtureOverrides,
  ) {
    return prisma.appointment.create({
      data: {
        bookingReference: `M7N-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey: `${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${queueNumber}-${discriminator.slice(0, 12)}`,
        firstName: 'Queue',
        lastName: discriminator,
        ...overrides,
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function uniqueServiceDate(outcome: NextPatientOutcome): string {
  if (outcome === NextPatientOutcome.NOW_SERVING) return '2026-09-01';
  if (outcome === NextPatientOutcome.COMPLETED) return '2026-09-02';
  return '2026-09-03';
}
