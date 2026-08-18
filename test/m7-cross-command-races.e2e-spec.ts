import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  BookingAccessTokenPurpose,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PatientBookingAccessService } from './../src/patient-access/patient-booking-access.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { NextPatientOutcome } from './../src/queue/dto/next-patient.dto';
import { ImHereService } from './../src/queue/im-here.service';
import { NextPatientService } from './../src/queue/next-patient.service';
import { QueueServingOrderPlacementService } from './../src/queue/queue-serving-order-placement.service';
import { StaffReinsertService } from './../src/queue/staff-reinsert.service';
import { UndoQueueService } from './../src/queue/undo-queue.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

type AppointmentOverrides = Partial<
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

describe('Milestone 7 cross-command queue races (e2e)', () => {
  let prisma: PrismaService;
  let nextPatient: NextPatientService;
  let imHere: ImHereService;
  let staffReinsert: StaffReinsertService;
  let undoQueue: UndoQueueService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const idempotency = new CommandIdempotencyService();
    const scheduleTime = new ScheduleTimeService();
    const placement = new QueueServingOrderPlacementService();

    nextPatient = new NextPatientService(prisma, idempotency, scheduleTime);
    imHere = new ImHereService(
      prisma,
      idempotency,
      new PatientBookingAccessService(prisma),
      placement,
    );
    staffReinsert = new StaffReinsertService(
      prisma,
      idempotency,
      scheduleTime,
      placement,
    );
    undoQueue = new UndoQueueService(prisma, idempotency, scheduleTime);

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-cross-${scope.slice(0, 12)}@example.test`,
        firstName: 'Cross',
        lastName: 'Race',
        mobileNumber: `0970${scope.slice(0, 7)}`,
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
        specialization: 'Cross Command Races',
        licenseNumber: `M7X-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Cross ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serializes NEXT PATIENT versus I'M HERE against current committed Serving Order", async () => {
    const serviceDate = '2026-10-20';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, 'IMHERE-CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const protectedNext = await createAppointment(date, 2, 'IMHERE-NEXT', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 3, 'IMHERE-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const rawToken = await issueToken(absent.id, date);

    const [nextResult, imHereResult] = await Promise.allSettled([
      nextPatient.advance(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          patientOutcome: NextPatientOutcome.COMPLETED,
        },
        `cross-next-imhere-next-${scope}`,
      ),
      imHere.reinsert(
        absent.bookingReference,
        rawToken,
        `cross-next-imhere-return-${scope}`,
      ),
    ]);

    expect(nextResult.status).toBe('fulfilled');
    expect(imHereResult.status).toBe('fulfilled');

    const [currentAfter, nextAfter, absentAfter] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: current.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: protectedNext.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
    ]);
    expect(currentAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(nextAfter.status).toBe(AppointmentStatus.CALLED);
    expect(absentAfter.status).toBe(AppointmentStatus.WAITING);
    expect(absentAfter.waitingPlacementType).toBe(WaitingPlacementType.IM_HERE);
    expect(absentAfter.servingOrderKey).not.toBeNull();
    expect(await calledCount(date)).toBe(1);
  });

  it('serializes NEXT PATIENT versus Staff Reinsert and recalculates legal placement', async () => {
    const serviceDate = '2026-10-21';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const current = await createAppointment(date, 1, 'STAFF-CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const protectedNext = await createAppointment(date, 2, 'STAFF-NEXT', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const ordinary = await createAppointment(date, 3, 'STAFF-ORDINARY', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 4, 'STAFF-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    const [nextResult, reinsertResult] = await Promise.allSettled([
      nextPatient.advance(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          patientOutcome: NextPatientOutcome.COMPLETED,
        },
        `cross-next-staff-next-${scope}`,
      ),
      staffReinsert.reinsert(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          appointmentId: absent.id,
          afterAppointmentId: ordinary.id,
        },
        `cross-next-staff-reinsert-${scope}`,
      ),
    ]);

    expect(nextResult.status).toBe('fulfilled');
    expect(reinsertResult.status).toBe('fulfilled');

    const [currentAfter, nextAfter, absentAfter] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: current.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: protectedNext.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
    ]);
    expect(currentAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(nextAfter.status).toBe(AppointmentStatus.CALLED);
    expect(absentAfter.status).toBe(AppointmentStatus.WAITING);
    expect(absentAfter.waitingPlacementType).toBe(
      WaitingPlacementType.STAFF_REINSERT,
    );
    expect(absentAfter.servingOrderKey).not.toBeNull();
    expect(await calledCount(date)).toBe(1);
  });

  it('serializes UNDO versus a subsequent Staff Reinsert without stale reversal', async () => {
    const serviceDate = '2026-10-22';
    const date = dateValue(serviceDate);
    await createStartedClinicDay(date);
    const first = await createAppointment(date, 1, 'UNDO-FIRST', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date(),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const second = await createAppointment(date, 2, 'UNDO-SECOND', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const third = await createAppointment(date, 3, 'UNDO-THIRD', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(2),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });
    const absent = await createAppointment(date, 4, 'UNDO-ABSENT', {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });

    await nextPatient.advance(
      doctorUserId,
      {
        practiceLocationId,
        serviceDate,
        patientOutcome: NextPatientOutcome.COMPLETED,
      },
      `cross-undo-source-${scope}`,
    );

    const [undoResult, reinsertResult] = await Promise.allSettled([
      undoQueue.undo(
        doctorUserId,
        { practiceLocationId, serviceDate },
        `cross-undo-command-${scope}`,
      ),
      staffReinsert.reinsert(
        doctorUserId,
        {
          practiceLocationId,
          serviceDate,
          appointmentId: absent.id,
          afterAppointmentId: third.id,
        },
        `cross-undo-staff-${scope}`,
      ),
    ]);

    expect(reinsertResult.status).toBe('fulfilled');

    const [firstAfter, secondAfter, absentAfter] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: second.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: absent.id } }),
    ]);
    expect(absentAfter.status).toBe(AppointmentStatus.WAITING);
    expect(absentAfter.waitingPlacementType).toBe(
      WaitingPlacementType.STAFF_REINSERT,
    );

    if (undoResult.status === 'fulfilled') {
      expect(firstAfter.status).toBe(AppointmentStatus.CALLED);
      expect(secondAfter.status).toBe(AppointmentStatus.WAITING);
    } else {
      expect(firstAfter.status).toBe(AppointmentStatus.COMPLETED);
      expect(secondAfter.status).toBe(AppointmentStatus.CALLED);
    }
    expect(await calledCount(date)).toBe(1);
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

  async function createAppointment(
    serviceDate: Date,
    queueNumber: number,
    discriminator: string,
    overrides: AppointmentOverrides,
  ) {
    const activeAppointmentKey = createHash('sha256')
      .update(
        `${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`,
      )
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `M7X-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(8, 10)}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        firstName: 'Cross',
        lastName: discriminator,
        ...overrides,
      },
    });
  }

  async function issueToken(
    appointmentId: string,
    serviceDate: Date,
  ): Promise<string> {
    const rawToken = Buffer.from(randomUUID())
      .toString('base64url')
      .replaceAll('=', '');
    await prisma.bookingAccessToken.create({
      data: {
        appointmentId,
        tokenHash: createHash('sha256')
          .update(rawToken, 'utf8')
          .digest('hex'),
        purpose: BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING,
        expiresAt: new Date(serviceDate.getTime() + 10 * 24 * 60 * 60 * 1000),
      },
    });
    return rawToken;
  }

  async function calledCount(serviceDate: Date): Promise<number> {
    return prisma.appointment.count({
      where: {
        practiceLocationId,
        serviceDate,
        status: AppointmentStatus.CALLED,
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
