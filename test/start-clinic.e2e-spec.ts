import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
  Weekday,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { StartClinicService } from './../src/queue/start-clinic.service';
import { ScheduleResolutionService } from './../src/schedule/schedule-resolution.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('START CLINIC controls (e2e)', () => {
  let prisma: PrismaService;
  let service: StartClinicService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let regularSecretaryUserId: string;
  let regularPracticeStaffId: string;
  let otherSecretaryUserId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const scheduleTime = new ScheduleTimeService();
    const scheduleResolution = new ScheduleResolutionService(
      prisma,
      scheduleTime,
    );
    service = new StartClinicService(
      prisma,
      new CommandIdempotencyService(),
      scheduleResolution,
      scheduleTime,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-start-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Start',
        lastName: 'Doctor',
        mobileNumber: `0917${scope.slice(0, 7)}`,
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
        specialization: 'Queue Operations',
        licenseNumber: `M7S-${scope.slice(0, 12)}`,
      },
    });

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Start ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regularSecretary = await prisma.user.create({
      data: {
        email: `m7-start-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Regular',
        lastName: 'Secretary',
        mobileNumber: `0918${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    regularSecretaryUserId = regularSecretary.id;

    const regularAssignment = await prisma.practiceStaff.create({
      data: {
        userId: regularSecretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    regularPracticeStaffId = regularAssignment.id;

    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: regularAssignment.id },
    });

    const otherSecretary = await prisma.user.create({
      data: {
        email: `m7-other-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Other',
        lastName: 'Secretary',
        mobileNumber: `0919${scope.slice(0, 7)}`,
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

    for (const weekday of Object.values(Weekday)) {
      await prisma.practiceSchedule.upsert({
        where: {
          practiceLocationId_weekday: { practiceLocationId, weekday },
        },
        update: {
          isOpen: true,
          opensAtLocal: timeValue(8, 0),
          closesAtLocal: timeValue(17, 0),
          maximumOnlineBookingUntilLocal: timeValue(16, 0),
          maximumOperatingUntilLocal: timeValue(18, 0),
        },
        create: {
          practiceLocationId,
          weekday,
          isOpen: true,
          opensAtLocal: timeValue(8, 0),
          closesAtLocal: timeValue(17, 0),
          maximumOnlineBookingUntilLocal: timeValue(16, 0),
          maximumOperatingUntilLocal: timeValue(18, 0),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('starts an empty clinic and records one START_CLINIC event without an Appointment link', async () => {
    const serviceDate = '2026-08-24';
    const result = await service.start(
      doctorUserId,
      { practiceLocationId, serviceDate },
      `empty-${scope}`,
    );

    expect(result.started).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.calledAppointmentId).toBeNull();

    const [clinicDay, queueEvent, links, command] = await Promise.all([
      prisma.clinicDay.findUniqueOrThrow({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        },
      }),
      prisma.queueEvent.findUniqueOrThrow({
        where: { id: result.queueEventId },
      }),
      prisma.queueEventAppointmentLink.findMany({
        where: { queueEventId: result.queueEventId },
      }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: 'START_CLINIC',
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          actorUserId: doctorUserId,
        },
      }),
    ]);

    expect(clinicDay.status).toBe('STARTED');
    expect(clinicDay.operatingPracticeStaffId).toBe(regularPracticeStaffId);
    expect(queueEvent.type).toBe('START_CLINIC');
    expect(queueEvent.queueEventSequence).toBe(1n);
    expect(links).toHaveLength(0);
    expect(command.resultQueueEventId).toBe(result.queueEventId);
    expect(command.resultAppointmentId).toBeNull();
  });

  it('calls the first authoritative WAITING Appointment and replays without advancing the queue', async () => {
    const serviceDate = '2026-08-25';
    const date = dateValue(serviceDate);
    const first = await createWaitingAppointment(date, 1, 'FIRST');
    const second = await createWaitingAppointment(date, 2, 'SECOND');

    const firstResult = await service.start(
      doctorUserId,
      { practiceLocationId, serviceDate },
      `first-${scope}`,
    );
    expect(firstResult.calledAppointmentId).toBe(first.id);
    expect(firstResult.replayed).toBe(false);

    const replay = await service.start(
      doctorUserId,
      { practiceLocationId, serviceDate },
      `first-${scope}`,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.calledAppointmentId).toBe(first.id);
    expect(replay.queueEventId).toBe(firstResult.queueEventId);

    const [firstAfter, secondAfter, events, commands, links] =
      await Promise.all([
        prisma.appointment.findUniqueOrThrow({ where: { id: first.id } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: second.id } }),
        prisma.queueEvent.findMany({
          where: { practiceLocationId, serviceDate: date },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            commandType: 'START_CLINIC',
            practiceLocationId,
            serviceDate: date,
          },
        }),
        prisma.queueEventAppointmentLink.findMany({
          where: { queueEventId: firstResult.queueEventId },
        }),
      ]);

    expect(firstAfter.status).toBe(AppointmentStatus.CALLED);
    expect(firstAfter.servingOrderKey).toBeNull();
    expect(firstAfter.waitingPlacementType).toBeNull();
    expect(secondAfter.status).toBe(AppointmentStatus.WAITING);
    expect(secondAfter.servingOrderKey?.toString()).toBe('2');
    expect(events).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(links).toHaveLength(1);
    expect(links[0]?.appointmentId).toBe(first.id);
  });

  it('rejects a secretary who is assigned to the location but is not the operating secretary', async () => {
    const serviceDate = '2026-08-26';

    await expect(
      service.start(
        otherSecretaryUserId,
        { practiceLocationId, serviceDate },
        `unauthorized-${scope}`,
      ),
    ).rejects.toThrow('current operating secretary');

    const [clinicDay, eventCount, commandCount] = await Promise.all([
      prisma.clinicDay.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        },
      }),
      prisma.queueEvent.count({
        where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
      }),
      prisma.commandIdempotency.count({
        where: {
          commandType: 'START_CLINIC',
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          actorUserId: otherSecretaryUserId,
        },
      }),
    ]);

    expect(clinicDay).toBeNull();
    expect(eventCount).toBe(0);
    expect(commandCount).toBe(0);
  });

  it('allows the current regular secretary to start the clinic', async () => {
    const serviceDate = '2026-08-27';

    const result = await service.start(
      regularSecretaryUserId,
      { practiceLocationId, serviceDate },
      `regular-secretary-${scope}`,
    );

    expect(result.started).toBe(true);
    const clinicDay = await prisma.clinicDay.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
        },
      },
    });
    expect(clinicDay.operatingPracticeStaffId).toBe(regularPracticeStaffId);
  });

  it('serializes concurrent distinct START_CLINIC commands so only one commit starts the day', async () => {
    const serviceDate = '2026-08-28';
    const date = dateValue(serviceDate);
    const appointment = await createWaitingAppointment(date, 1, 'RACE');

    const settled = await Promise.allSettled([
      service.start(
        doctorUserId,
        { practiceLocationId, serviceDate },
        `race-a-${scope}`,
      ),
      service.start(
        doctorUserId,
        { practiceLocationId, serviceDate },
        `race-b-${scope}`,
      ),
    ]);

    expect(
      settled.filter((item) => item.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      settled.filter((item) => item.status === 'rejected'),
    ).toHaveLength(1);

    const [clinicDays, events, commands, appointmentAfter] =
      await Promise.all([
        prisma.clinicDay.findMany({
          where: { practiceLocationId, serviceDate: date },
        }),
        prisma.queueEvent.findMany({
          where: { practiceLocationId, serviceDate: date },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            commandType: 'START_CLINIC',
            practiceLocationId,
            serviceDate: date,
          },
        }),
        prisma.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        }),
      ]);

    expect(clinicDays).toHaveLength(1);
    expect(clinicDays[0]?.status).toBe('STARTED');
    expect(events).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(appointmentAfter.status).toBe(AppointmentStatus.CALLED);
  });

  async function createWaitingAppointment(
    serviceDate: Date,
    order: number,
    discriminator: string,
  ) {
    return prisma.appointment.create({
      data: {
        bookingReference: `M7S-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber: order,
        servingOrderKey: new Prisma.Decimal(order),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        status: AppointmentStatus.WAITING,
        firstName: 'Queue',
        lastName: discriminator,
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function timeValue(hour: number, minute: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}
