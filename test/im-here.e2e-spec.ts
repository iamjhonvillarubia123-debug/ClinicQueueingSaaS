import { createHash, randomUUID } from 'crypto';
import {
  AppointmentStatus,
  BookingAccessTokenPurpose,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  QueueEventActorType,
  QueueEventType,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PatientBookingAccessService } from './../src/patient-access/patient-booking-access.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { ImHereService } from './../src/queue/im-here.service';
import { QueueServingOrderPlacementService } from './../src/queue/queue-serving-order-placement.service';

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

describe("I'M HERE controls (e2e)", () => {
  let prisma: PrismaService;
  let service: ImHereService;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const patientAccess = new PatientBookingAccessService(prisma);
    service = new ImHereService(
      prisma,
      new CommandIdempotencyService(),
      patientAccess,
      new QueueServingOrderPlacementService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-imhere-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'ImHere',
        lastName: 'Doctor',
        mobileNumber: `0950${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Im Here',
        licenseNumber: `M7I-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 ImHere ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reinstates an eligible individual Appointment once without changing Queue Number', async () => {
    const serviceDate = dateValue('2026-10-01');
    await createStartedClinicDay(serviceDate);
    const protectedNext = await createWaiting(serviceDate, 1, 'BASIC-PROTECTED', 1);
    const absent = await createAppointment(serviceDate, 99, 'BASIC-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const rawToken = await issueToken(absent.id, serviceDate);

    const result = await service.reinsert(
      absent.bookingReference,
      rawToken,
      `imhere-basic-${scope}`,
    );

    const [after, waiting, event, command] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
      prisma.appointment.findMany({
        where: {
          practiceLocationId,
          serviceDate,
          status: AppointmentStatus.WAITING,
        },
        orderBy: { servingOrderKey: 'asc' },
        select: { id: true },
      }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.commandIdempotency.findFirstOrThrow({
        where: {
          commandType: CommandType.SELF_SERVICE_REINSERTION,
          appointmentId: absent.id,
        },
      }),
    ]);

    expect(after.status).toBe(AppointmentStatus.WAITING);
    expect(after.waitingPlacementType).toBe(WaitingPlacementType.IM_HERE);
    expect(after.queueNumber).toBe(99);
    expect(after.selfServiceReinsertedAt).not.toBeNull();
    expect(waiting.map((item) => item.id)).toEqual([protectedNext.id, absent.id]);
    expect(event.type).toBe(QueueEventType.SELF_SERVICE_REINSERTION);
    expect(event.actorType).toBe(QueueEventActorType.PATIENT);
    expect(command.idempotencyKey).toBe(`imhere-basic-${scope}`);
  });

  it('places I\'M HERE after Protected Next and committed RETURN_TO_QUEUE entries', async () => {
    const serviceDate = dateValue('2026-10-02');
    await createStartedClinicDay(serviceDate);
    const protectedNext = await createWaiting(serviceDate, 1, 'ORDER-PROTECTED', 1);
    const returnedA = await createWaiting(
      serviceDate,
      2,
      'ORDER-RETURN-A',
      2,
      WaitingPlacementType.RETURN_TO_QUEUE,
    );
    const returnedB = await createWaiting(
      serviceDate,
      3,
      'ORDER-RETURN-B',
      3,
      WaitingPlacementType.RETURN_TO_QUEUE,
    );
    const ordinary = await createWaiting(serviceDate, 4, 'ORDER-ORDINARY', 4);
    const absent = await createAppointment(serviceDate, 50, 'ORDER-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await service.reinsert(
      absent.bookingReference,
      await issueToken(absent.id, serviceDate),
      `imhere-order-${scope}`,
    );

    const waiting = await waitingIds(serviceDate);
    expect(waiting).toEqual([
      protectedNext.id,
      returnedA.id,
      returnedB.id,
      absent.id,
      ordinary.id,
    ]);
  });

  it('does not split an active protected BookingGroup sequence', async () => {
    const serviceDate = dateValue('2026-10-03');
    await createStartedClinicDay(serviceDate);
    const group = await prisma.bookingGroup.create({
      data: { practiceLocationId, serviceDate },
    });
    const groupA = await createWaiting(serviceDate, 1, 'GROUP-A', 1, WaitingPlacementType.ORDINARY, group.id);
    const groupB = await createWaiting(serviceDate, 2, 'GROUP-B', 2, WaitingPlacementType.ORDINARY, group.id);
    const groupC = await createWaiting(serviceDate, 3, 'GROUP-C', 3, WaitingPlacementType.ORDINARY, group.id);
    const ordinary = await createWaiting(serviceDate, 4, 'GROUP-ORDINARY', 4);
    const absent = await createAppointment(serviceDate, 60, 'GROUP-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await service.reinsert(
      absent.bookingReference,
      await issueToken(absent.id, serviceDate),
      `imhere-group-${scope}`,
    );

    expect(await waitingIds(serviceDate)).toEqual([
      groupA.id,
      groupB.id,
      groupC.id,
      absent.id,
      ordinary.id,
    ]);
  });

  it('rejects BookingGroup members even with a valid individual token record', async () => {
    const serviceDate = dateValue('2026-10-04');
    await createStartedClinicDay(serviceDate);
    const group = await prisma.bookingGroup.create({
      data: { practiceLocationId, serviceDate },
    });
    const member = await createAppointment(serviceDate, 7, 'GROUP-MEMBER', {
      bookingGroupId: group.id,
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await expect(
      service.reinsert(
        member.bookingReference,
        await issueToken(member.id, serviceDate),
        `imhere-group-reject-${scope}`,
      ),
    ).rejects.toThrow("I'M HERE is unavailable");
  });

  it('rejects VIEW_ONLY, wrong-booking, expired, and revoked credentials', async () => {
    const serviceDate = dateValue('2026-10-05');
    await createStartedClinicDay(serviceDate);
    const absent = await createAppointment(serviceDate, 8, 'TOKEN-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const other = await createAppointment(serviceDate, 9, 'TOKEN-OTHER', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await expect(
      service.reinsert(
        absent.bookingReference,
        await issueToken(absent.id, serviceDate, BookingAccessTokenPurpose.VIEW_ONLY),
        `imhere-viewonly-${scope}`,
      ),
    ).rejects.toThrow('Patient booking access is unavailable');

    await expect(
      service.reinsert(
        absent.bookingReference,
        await issueToken(other.id, serviceDate),
        `imhere-wrong-${scope}`,
      ),
    ).rejects.toThrow('Patient booking access is unavailable');

    await expect(
      service.reinsert(
        absent.bookingReference,
        await issueToken(absent.id, serviceDate, BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING, new Date(Date.now() - 1000)),
        `imhere-expired-${scope}`,
      ),
    ).rejects.toThrow('Patient booking access is unavailable');

    const revokedToken = await issueToken(absent.id, serviceDate);
    await prisma.bookingAccessToken.update({
      where: { tokenHash: tokenHash(revokedToken) },
      data: { revokedAt: new Date() },
    });
    await expect(
      service.reinsert(
        absent.bookingReference,
        revokedToken,
        `imhere-revoked-${scope}`,
      ),
    ).rejects.toThrow('Patient booking access is unavailable');
  });

  it('replays the same command but permanently rejects a second self-service reinsertion', async () => {
    const serviceDate = dateValue('2026-10-06');
    await createStartedClinicDay(serviceDate);
    await createWaiting(serviceDate, 1, 'REPLAY-PROTECTED', 1);
    const absent = await createAppointment(serviceDate, 10, 'REPLAY-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const rawToken = await issueToken(absent.id, serviceDate);
    const key = `imhere-replay-${scope}`;

    const first = await service.reinsert(absent.bookingReference, rawToken, key);
    const replay = await service.reinsert(absent.bookingReference, rawToken, key);
    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);

    await prisma.appointment.update({
      where: { id: absent.id },
      data: {
        status: AppointmentStatus.TEMPORARILY_ABSENT,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    });

    await expect(
      service.reinsert(
        absent.bookingReference,
        rawToken,
        `imhere-second-cycle-${scope}`,
      ),
    ).rejects.toThrow("I'M HERE is unavailable");

    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate,
          type: QueueEventType.SELF_SERVICE_REINSERTION,
        },
      }),
    ).toBe(1);
  });

  it('serializes concurrent I\'M HERE attempts so only one mutation is committed', async () => {
    const serviceDate = dateValue('2026-10-07');
    await createStartedClinicDay(serviceDate);
    await createWaiting(serviceDate, 1, 'RACE-PROTECTED', 1);
    const absent = await createAppointment(serviceDate, 11, 'RACE-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const rawToken = await issueToken(absent.id, serviceDate);

    const results = await Promise.allSettled([
      service.reinsert(absent.bookingReference, rawToken, `imhere-race-a-${scope}`),
      service.reinsert(absent.bookingReference, rawToken, `imhere-race-b-${scope}`),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.queueEvent.count({
        where: {
          practiceLocationId,
          serviceDate,
          type: QueueEventType.SELF_SERVICE_REINSERTION,
        },
      }),
    ).toBe(1);
  });

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

  async function createWaiting(
    serviceDate: Date,
    queueNumber: number,
    discriminator: string,
    order: number,
    placement: WaitingPlacementType = WaitingPlacementType.ORDINARY,
    bookingGroupId?: string,
  ) {
    return createAppointment(serviceDate, queueNumber, discriminator, {
      bookingGroupId,
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(order),
      waitingPlacementType: placement,
    });
  }

  async function createAppointment(
    serviceDate: Date,
    queueNumber: number,
    discriminator: string,
    overrides: AppointmentFixtureOverrides,
  ) {
    const activeAppointmentKey = createHash('sha256')
      .update(`${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`)
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `M7I-${scope.slice(0, 8)}-${serviceDate.toISOString().slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        firstName: 'Patient',
        lastName: discriminator,
        ...overrides,
      },
    });
  }

  async function issueToken(
    appointmentId: string,
    serviceDate: Date,
    purpose: BookingAccessTokenPurpose = BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING,
    expiresAt = new Date(serviceDate.getTime() + 10 * 24 * 60 * 60 * 1000),
  ): Promise<string> {
    const rawToken = Buffer.from(randomUUID()).toString('base64url').replaceAll('=', '');
    await prisma.bookingAccessToken.create({
      data: {
        appointmentId,
        tokenHash: tokenHash(rawToken),
        purpose,
        expiresAt,
      },
    });
    return rawToken;
  }

  async function waitingIds(serviceDate: Date): Promise<string[]> {
    const rows = await prisma.appointment.findMany({
      where: {
        practiceLocationId,
        serviceDate,
        status: AppointmentStatus.WAITING,
      },
      orderBy: { servingOrderKey: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
});

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
