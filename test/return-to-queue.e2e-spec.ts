import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
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
import { ReturnToQueueDto } from './../src/queue/dto/return-to-queue.dto';
import { QueueServingOrderPlacementService } from './../src/queue/queue-serving-order-placement.service';
import { ReturnToQueueService } from './../src/queue/return-to-queue.service';
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

describe('RETURN TO QUEUE controls (e2e)', () => {
  let prisma: PrismaService;
  let service: ReturnToQueueService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let operatingSecretaryUserId: string;
  let operatingPracticeStaffId: string;
  let otherSecretaryUserId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ReturnToQueueService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
      new QueueServingOrderPlacementService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-return-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Return',
        lastName: 'Doctor',
        mobileNumber: `0930${scope.slice(0, 7)}`,
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
        specialization: 'Procedure Return',
        licenseNumber: `M7R-${scope.slice(0, 12)}`,
      },
    });

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Return ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `m7-return-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Operating',
        lastName: 'Secretary',
        mobileNumber: `0931${scope.slice(0, 7)}`,
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
        email: `m7-return-other-${scope.slice(0, 12)}@example.test`,
        firstName: 'Other',
        lastName: 'Secretary',
        mobileNumber: `0932${scope.slice(0, 7)}`,
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

  it('returns after Protected Next and before ordinary waiting without changing Queue Number', async () => {
    const serviceDate = '2026-09-11';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 10, 'PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinary = await createAppointment(date, 2, 'ORDINARY', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const returning = await createAppointment(date, 99, 'RETURNING', {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const result = await service.returnToQueue(
      doctorUserId,
      dto(serviceDate, returning.id),
      `return-basic-${scope}`,
    );

    const [after, waiting, event, command] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: returning.id } }),
      prisma.appointment.findMany({
        where: {
          practiceLocationId,
          serviceDate: date,
          status: AppointmentStatus.WAITING,
        },
        orderBy: { servingOrderKey: 'asc' },
      }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: 'RETURN_TO_QUEUE',
          practiceLocationId,
          serviceDate: date,
          actorUserId: doctorUserId,
        },
      }),
    ]);

    expect(after.status).toBe(AppointmentStatus.WAITING);
    expect(after.waitingPlacementType).toBe(WaitingPlacementType.RETURN_TO_QUEUE);
    expect(after.queueNumber).toBe(99);
    expect(waiting.map((item) => item.id)).toEqual([
      protectedNext.id,
      returning.id,
      ordinary.id,
    ]);
    expect(event.type).toBe(QueueEventType.RETURN_TO_QUEUE);
    expect(command.appointmentId).toBe(returning.id);
    expect(command.resultQueueEventId).toBe(result.queueEventId);
  });

  it('appends behind an existing RETURN_TO_QUEUE block', async () => {
    const serviceDate = '2026-09-12';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'PROTECTED-BLOCK', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const existingReturn = await createAppointment(date, 4, 'EXISTING-RETURN', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('1.5'),
      waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
    });
    const ordinary = await createAppointment(date, 2, 'ORDINARY-BLOCK', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const returning = await createAppointment(date, 8, 'RETURNING-BLOCK', {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await service.returnToQueue(
      doctorUserId,
      dto(serviceDate, returning.id),
      `return-block-${scope}`,
    );

    const waiting = await prisma.appointment.findMany({
      where: {
        practiceLocationId,
        serviceDate: date,
        status: AppointmentStatus.WAITING,
      },
      orderBy: { servingOrderKey: 'asc' },
      select: { id: true },
    });

    expect(waiting.map((item) => item.id)).toEqual([
      protectedNext.id,
      existingReturn.id,
      returning.id,
      ordinary.id,
    ]);
  });

  it('replays the same command without inserting twice', async () => {
    const serviceDate = '2026-09-13';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    await createAppointment(date, 1, 'REPLAY-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const returning = await createAppointment(date, 7, 'REPLAY-RETURN', {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const first = await service.returnToQueue(
      doctorUserId,
      dto(serviceDate, returning.id),
      `return-replay-${scope}`,
    );
    const replay = await service.returnToQueue(
      doctorUserId,
      dto(serviceDate, returning.id),
      `return-replay-${scope}`,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate: date,
          type: QueueEventType.RETURN_TO_QUEUE,
        },
      }),
    ).toBe(1);
  });

  it('rejects a non-procedure Appointment', async () => {
    const serviceDate = '2026-09-14';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const waiting = await createAppointment(date, 1, 'WRONG-STATE', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    await expect(
      service.returnToQueue(
        doctorUserId,
        dto(serviceDate, waiting.id),
        `return-wrong-${scope}`,
      ),
    ).rejects.toThrow('not eligible to return from procedure');
  });

  it('allows the operating secretary and rejects another assigned secretary', async () => {
    const allowedDate = '2026-09-15';
    await createStartedClinicDay(dateValue(allowedDate));
    await createAppointment(dateValue(allowedDate), 1, 'SEC-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const allowedReturn = await createAppointment(
      dateValue(allowedDate),
      2,
      'SEC-RETURN',
      {
        status: AppointmentStatus.OUT_FOR_PROCEDURE,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    );
    await expect(
      service.returnToQueue(
        operatingSecretaryUserId,
        dto(allowedDate, allowedReturn.id),
        `return-sec-ok-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });

    const deniedDate = '2026-09-16';
    await createStartedClinicDay(dateValue(deniedDate));
    await createAppointment(dateValue(deniedDate), 1, 'SEC-DENIED-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const deniedReturn = await createAppointment(
      dateValue(deniedDate),
      2,
      'SEC-DENIED-RETURN',
      {
        status: AppointmentStatus.OUT_FOR_PROCEDURE,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    );
    await expect(
      service.returnToQueue(
        otherSecretaryUserId,
        dto(deniedDate, deniedReturn.id),
        `return-sec-no-${scope}`,
      ),
    ).rejects.toThrow('current operating secretary');
  });

  it('serializes concurrent returns in successful-return order', async () => {
    const serviceDate = '2026-09-17';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'RACE-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinary = await createAppointment(date, 2, 'RACE-ORDINARY', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const returnA = await createAppointment(date, 10, 'RACE-A', {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const returnB = await createAppointment(date, 11, 'RACE-B', {
      status: AppointmentStatus.OUT_FOR_PROCEDURE,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const settled = await Promise.allSettled([
      service.returnToQueue(
        doctorUserId,
        dto(serviceDate, returnA.id),
        `return-race-a-${scope}`,
      ),
      service.returnToQueue(
        doctorUserId,
        dto(serviceDate, returnB.id),
        `return-race-b-${scope}`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(2);
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(0);

    const [waiting, events] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          practiceLocationId,
          serviceDate: date,
          status: AppointmentStatus.WAITING,
        },
        orderBy: { servingOrderKey: 'asc' },
        select: { id: true, waitingPlacementType: true },
      }),
      prisma.queueEvent.findMany({
        where: {
          practiceLocationId,
          serviceDate: date,
          type: QueueEventType.RETURN_TO_QUEUE,
        },
        orderBy: { queueEventSequence: 'asc' },
        include: {
          appointmentLinks: {
            select: { appointmentId: true, role: true },
          },
        },
      }),
    ]);

    expect(events).toHaveLength(2);
    const returnedOrder = events.map(
      (event) => event.appointmentLinks.find((link) => link.role === 'PRIMARY')!
        .appointmentId,
    );
    expect(waiting.map((item) => item.id)).toEqual([
      protectedNext.id,
      ...returnedOrder,
      ordinary.id,
    ]);
    expect(
      waiting.slice(1, 3).every(
        (item) => item.waitingPlacementType === WaitingPlacementType.RETURN_TO_QUEUE,
      ),
    ).toBe(true);
  });

  function dto(serviceDate: string, appointmentId: string): ReturnToQueueDto {
    return { practiceLocationId, serviceDate, appointmentId };
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
    const activeAppointmentKey = createHash('sha256')
      .update(
        `${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`,
      )
      .digest('hex');

    return prisma.appointment.create({
      data: {
        bookingReference: `M7R-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
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
