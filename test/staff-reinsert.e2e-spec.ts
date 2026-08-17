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
import { StaffReinsertDto } from './../src/queue/dto/staff-reinsert.dto';
import { QueueServingOrderPlacementService } from './../src/queue/queue-serving-order-placement.service';
import { StaffReinsertService } from './../src/queue/staff-reinsert.service';
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

describe('STAFF REINSERT controls (e2e)', () => {
  let prisma: PrismaService;
  let service: StaffReinsertService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let operatingSecretaryUserId: string;
  let operatingPracticeStaffId: string;
  let otherSecretaryUserId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new StaffReinsertService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
      new QueueServingOrderPlacementService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-reinsert-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Reinsert',
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
        specialization: 'Staff Reinsert',
        licenseNumber: `M7S-${scope.slice(0, 12)}`,
      },
    });

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Reinsert ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `m7-reinsert-secretary-${scope.slice(0, 12)}@example.test`,
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
        email: `m7-reinsert-other-${scope.slice(0, 12)}@example.test`,
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

  it('reinstates a temporarily absent Appointment after an eligible neighbor without changing Queue Number', async () => {
    const serviceDate = '2026-09-18';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const returnBlock = await createAppointment(date, 2, 'RETURN-BLOCK', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('1.5'),
      waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
    });
    const ordinaryA = await createAppointment(date, 3, 'ORDINARY-A', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinaryB = await createAppointment(date, 4, 'ORDINARY-B', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(3),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 99, 'ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const result = await service.reinsert(
      doctorUserId,
      dto(serviceDate, absent.id, ordinaryA.id),
      `staff-basic-${scope}`,
    );

    const [after, waiting, event] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
      prisma.appointment.findMany({
        where: {
          practiceLocationId,
          serviceDate: date,
          status: AppointmentStatus.WAITING,
        },
        orderBy: { servingOrderKey: 'asc' },
        select: { id: true },
      }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
    ]);

    expect(after.status).toBe(AppointmentStatus.WAITING);
    expect(after.waitingPlacementType).toBe(WaitingPlacementType.STAFF_REINSERT);
    expect(after.queueNumber).toBe(99);
    expect(waiting.map((item) => item.id)).toEqual([
      protectedNext.id,
      returnBlock.id,
      ordinaryA.id,
      absent.id,
      ordinaryB.id,
    ]);
    expect(event.type).toBe(QueueEventType.STAFF_REINSERTION);
  });

  it('repositions an existing WAITING Appointment using a legal neighbor intention', async () => {
    const serviceDate = '2026-09-19';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'WAIT-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinaryA = await createAppointment(date, 2, 'WAIT-A', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const target = await createAppointment(date, 3, 'WAIT-TARGET', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(3),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinaryB = await createAppointment(date, 4, 'WAIT-B', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(4),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    await service.reinsert(
      doctorUserId,
      dto(serviceDate, target.id, protectedNext.id),
      `staff-waiting-${scope}`,
    );

    const waiting = await prisma.appointment.findMany({
      where: {
        practiceLocationId,
        serviceDate: date,
        status: AppointmentStatus.WAITING,
      },
      orderBy: { servingOrderKey: 'asc' },
      select: { id: true, waitingPlacementType: true },
    });

    expect(waiting.map((item) => item.id)).toEqual([
      protectedNext.id,
      target.id,
      ordinaryA.id,
      ordinaryB.id,
    ]);
    expect(waiting[1]?.waitingPlacementType).toBe(
      WaitingPlacementType.STAFF_REINSERT,
    );
  });

  it('rejects insertion before the committed RETURN_TO_QUEUE block', async () => {
    const serviceDate = '2026-09-20';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'BOUNDARY-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    await createAppointment(date, 2, 'BOUNDARY-RETURN', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('1.5'),
      waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
    });
    const absent = await createAppointment(date, 3, 'BOUNDARY-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await expect(
      service.reinsert(
        doctorUserId,
        dto(serviceDate, absent.id, protectedNext.id),
        `staff-boundary-${scope}`,
      ),
    ).rejects.toThrow('protected queue boundary');
  });

  it('rejects a stale or non-waiting neighbor intention', async () => {
    const serviceDate = '2026-09-21';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    await createAppointment(date, 1, 'STALE-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 2, 'STALE-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const staleNeighbor = await createAppointment(date, 3, 'STALE-NEIGHBOR', {
      status: AppointmentStatus.COMPLETED,
      servingOrderKey: null,
      waitingPlacementType: null,
      completedAt: new Date(),
      terminalAt: new Date(),
      activeAppointmentKey: null,
    });

    await expect(
      service.reinsert(
        doctorUserId,
        dto(serviceDate, absent.id, staleNeighbor.id),
        `staff-stale-${scope}`,
      ),
    ).rejects.toThrow('placement intention is stale');
  });

  it('forces a temporarily absent active BookingGroup member to the current group tail', async () => {
    const serviceDate = '2026-09-22';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'GROUP-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const group = await prisma.bookingGroup.create({
      data: { practiceLocationId, serviceDate: date },
    });
    const groupA = await createAppointment(date, 2, 'GROUP-A', {
      bookingGroupId: group.id,
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const groupB = await createAppointment(date, 3, 'GROUP-B', {
      bookingGroupId: group.id,
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(3),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinary = await createAppointment(date, 4, 'GROUP-OUTSIDE', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(4),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absentGroupMember = await createAppointment(date, 5, 'GROUP-ABSENT', {
      bookingGroupId: group.id,
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await service.reinsert(
      doctorUserId,
      dto(serviceDate, absentGroupMember.id, protectedNext.id),
      `staff-group-${scope}`,
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
      groupA.id,
      groupB.id,
      absentGroupMember.id,
      ordinary.id,
    ]);
  });

  it('uses ordinary Staff Reinsert after BookingGroup serving protection has ended', async () => {
    const serviceDate = '2026-09-23';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'ENDED-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinary = await createAppointment(date, 2, 'ENDED-ORDINARY', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId,
        serviceDate: date,
        servingProtectionEndedAt: new Date(),
      },
    });
    const absentGroupMember = await createAppointment(date, 3, 'ENDED-ABSENT', {
      bookingGroupId: group.id,
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await service.reinsert(
      doctorUserId,
      dto(serviceDate, absentGroupMember.id, protectedNext.id),
      `staff-group-ended-${scope}`,
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
      absentGroupMember.id,
      ordinary.id,
    ]);
  });

  it('replays the same Staff Reinsert command without applying it twice', async () => {
    const serviceDate = '2026-09-24';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const protectedNext = await createAppointment(date, 1, 'REPLAY-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 2, 'REPLAY-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const first = await service.reinsert(
      doctorUserId,
      dto(serviceDate, absent.id, protectedNext.id),
      `staff-replay-${scope}`,
    );
    const replay = await service.reinsert(
      doctorUserId,
      dto(serviceDate, absent.id, protectedNext.id),
      `staff-replay-${scope}`,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate: date,
          type: QueueEventType.STAFF_REINSERTION,
        },
      }),
    ).toBe(1);
  });

  it('allows the operating secretary and rejects another assigned secretary', async () => {
    const allowedDate = '2026-09-25';
    const allowed = dateValue(allowedDate);
    await createStartedClinicDay(allowed);
    const protectedAllowed = await createAppointment(allowed, 1, 'SEC-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const allowedAbsent = await createAppointment(allowed, 2, 'SEC-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    await expect(
      service.reinsert(
        operatingSecretaryUserId,
        dto(allowedDate, allowedAbsent.id, protectedAllowed.id),
        `staff-sec-ok-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });

    const deniedDate = '2026-09-26';
    const denied = dateValue(deniedDate);
    await createStartedClinicDay(denied);
    const protectedDenied = await createAppointment(denied, 1, 'SEC-DENIED-PROTECTED', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const deniedAbsent = await createAppointment(denied, 2, 'SEC-DENIED-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    await expect(
      service.reinsert(
        otherSecretaryUserId,
        dto(deniedDate, deniedAbsent.id, protectedDenied.id),
        `staff-sec-no-${scope}`,
      ),
    ).rejects.toThrow('current operating secretary');
  });

  function dto(
    serviceDate: string,
    appointmentId: string,
    afterAppointmentId?: string,
  ): StaffReinsertDto {
    return {
      practiceLocationId,
      serviceDate,
      appointmentId,
      afterAppointmentId,
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
    const activeAppointmentKey = createHash('sha256')
      .update(
        `${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`,
      )
      .digest('hex');

    return prisma.appointment.create({
      data: {
        bookingReference: `M7S-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        firstName: 'Staff',
        lastName: discriminator,
        ...overrides,
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
