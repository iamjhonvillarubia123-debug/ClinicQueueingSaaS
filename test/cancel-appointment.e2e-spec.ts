import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentCancelledByType,
  AppointmentStatus,
  ClinicDayStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { CancelAppointmentService } from './../src/queue/cancel-appointment.service';
import { NextPatientOutcome } from './../src/queue/dto/next-patient.dto';
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

describe('Appointment cancellation controls (e2e)', () => {
  let prisma: PrismaService;
  let cancelService: CancelAppointmentService;
  let nextPatientService: NextPatientService;
  let doctorUserId: string;
  let secretaryUserId: string;
  let unassignedSecretaryUserId: string;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const config = new ConfigService({
      MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-cancel-key',
    });
    cancelService = new CancelAppointmentService(
      prisma,
      new CommandIdempotencyService(),
      new NotificationPayloadService(config),
    );
    nextPatientService = new NextPatientService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m7-cancel-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Cancel',
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
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Cancellation Controls',
        licenseNumber: `M7C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M7 Cancel ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `m7-cancel-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Assigned',
        lastName: 'Secretary',
        mobileNumber: `0931${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    secretaryUserId = secretary.id;
    await prisma.practiceStaff.create({
      data: {
        userId: secretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });

    const unassignedSecretary = await prisma.user.create({
      data: {
        email: `m7-cancel-unassigned-${scope.slice(0, 12)}@example.test`,
        firstName: 'Unassigned',
        lastName: 'Secretary',
        mobileNumber: `0932${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    unassignedSecretaryUserId = unassignedSecretary.id;
  });

  afterAll(async () => prisma.$disconnect());

  it('doctor cancels WAITING Appointment atomically and preserves Queue Number', async () => {
    const serviceDate = '2026-10-01';
    const mobileNumberHash = createHash('sha256')
      .update(`cancel-mobile|${scope}|41`)
      .digest('hex');
    const appointment = await createAppointment(serviceDate, 41, {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(41),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
      mobileNumberEncrypted: `fixture-encrypted-${mobileNumberHash}`,
      mobileNumberHash,
      mobileNumberLastFour: '1234',
    });
    const result = await cancelService.cancel(
      doctorUserId,
      { appointmentId: appointment.id, reason: 'CLINIC_REQUESTED' },
      `doctor-cancel-${scope}`,
    );
    const [after, event, links, command, outbox] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
      prisma.queueEvent.findUniqueOrThrow({ where: { id: result.queueEventId } }),
      prisma.queueEventAppointmentLink.findMany({ where: { queueEventId: result.queueEventId } }),
      prisma.commandIdempotency.findFirstOrThrow({ where: { commandType: 'CANCEL_APPOINTMENT', appointmentId: appointment.id, actorUserId: doctorUserId } }),
      prisma.notificationOutbox.findFirst({ where: { notificationType: NotificationType.APPOINTMENT_CANCELLATION, appointmentId: appointment.id } }),
    ]);
    expect(after.status).toBe(AppointmentStatus.CANCELLED);
    expect(after.queueNumber).toBe(41);
    expect(after.servingOrderKey).toBeNull();
    expect(after.waitingPlacementType).toBeNull();
    expect(after.activeAppointmentKey).toBeNull();
    expect(after.cancelledAt).not.toBeNull();
    expect(after.terminalAt).not.toBeNull();
    expect(after.cancelledByType).toBe(AppointmentCancelledByType.DOCTOR);
    expect(after.cancellationReason).toBe('CLINIC_REQUESTED');
    expect(event.type).toBe(QueueEventType.APPOINTMENT_CANCELLED);
    expect(event.actorType).toBe(QueueEventActorType.USER);
    expect(event.actorUserId).toBe(doctorUserId);
    expect(event.previousPrimaryStatus).toBe(AppointmentStatus.WAITING);
    expect(event.newPrimaryStatus).toBe(AppointmentStatus.CANCELLED);
    expect(links).toHaveLength(1);
    expect(links[0]?.role).toBe(QueueEventAppointmentLinkRole.PRIMARY);
    expect(links[0]?.appointmentId).toBe(appointment.id);
    expect(command.resultAppointmentId).toBe(appointment.id);
    expect(command.resultQueueEventId).toBe(result.queueEventId);
    expect(outbox).not.toBeNull();
  });

  it('assigned Secretary can cancel and OTHER reason preserves note', async () => {
    const appointment = await createAppointment('2026-10-02', 42, {
      status: AppointmentStatus.TEMPORARILY_ABSENT,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    await cancelService.cancel(secretaryUserId, { appointmentId: appointment.id, reason: 'OTHER', note: 'Patient transferred care elsewhere' }, `secretary-cancel-${scope}`);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.status).toBe(AppointmentStatus.CANCELLED);
    expect(after.cancelledByType).toBe(AppointmentCancelledByType.SECRETARY);
    expect(after.cancellationReason).toBe('OTHER: Patient transferred care elsewhere');
  });

  it('rejects an unassigned Secretary', async () => {
    const appointment = await createAppointment('2026-10-03', 43);
    await expect(cancelService.cancel(unassignedSecretaryUserId, { appointmentId: appointment.id, reason: 'PATIENT_REQUESTED' }, `unauthorized-cancel-${scope}`)).rejects.toThrow('Secretary is not assigned');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe(AppointmentStatus.WAITING);
  });

  it('rejects terminal Appointment cancellation', async () => {
    const now = new Date();
    const appointment = await createAppointment('2026-10-04', 44, {
      status: AppointmentStatus.COMPLETED,
      terminalAt: now,
      completedAt: now,
      servingOrderKey: null,
      waitingPlacementType: null,
    }, false);
    await expect(cancelService.cancel(doctorUserId, { appointmentId: appointment.id, reason: 'CLINIC_REQUESTED' }, `terminal-cancel-${scope}`)).rejects.toThrow('not eligible for cancellation');
  });

  it('replays the same cancellation and conflicts on changed fingerprint', async () => {
    const appointment = await createAppointment('2026-10-05', 45);
    const key = `replay-cancel-${scope}`;
    const first = await cancelService.cancel(doctorUserId, { appointmentId: appointment.id, reason: 'DUPLICATE_BOOKING' }, key);
    const replay = await cancelService.cancel(doctorUserId, { appointmentId: appointment.id, reason: 'DUPLICATE_BOOKING' }, key);
    expect(replay.replayed).toBe(true);
    expect(replay.queueEventId).toBe(first.queueEventId);
    await expect(cancelService.cancel(doctorUserId, { appointmentId: appointment.id, reason: 'CLINIC_REQUESTED' }, key)).rejects.toThrow();
    expect(await prisma.queueEvent.count({ where: { practiceLocationId, serviceDate: dateValue('2026-10-05'), type: QueueEventType.APPOINTMENT_CANCELLED } })).toBe(1);
    expect(await prisma.commandIdempotency.count({ where: { commandType: 'CANCEL_APPOINTMENT', appointmentId: appointment.id, actorUserId: doctorUserId } })).toBe(1);
  });

  it('serializes cancellation versus NEXT PATIENT against authoritative state', async () => {
    const serviceDate = '2026-10-06';
    const queue = await createStartedClinicDayWithTwoAppointments(serviceDate);
    const [nextResult, cancelResult] = await Promise.allSettled([
      nextPatientService.advance(doctorUserId, { practiceLocationId, serviceDate, patientOutcome: NextPatientOutcome.COMPLETED }, `race-next-${scope}`),
      cancelService.cancel(doctorUserId, { appointmentId: queue.nextId, reason: 'CLINIC_REQUESTED' }, `race-cancel-${scope}`),
    ]);
    const current = await prisma.appointment.findUniqueOrThrow({ where: { id: queue.currentId } });
    const next = await prisma.appointment.findUniqueOrThrow({ where: { id: queue.nextId } });

    expect(cancelResult.status).toBe('fulfilled');
    if (nextResult.status === 'fulfilled') {
      expect(current.status).toBe(AppointmentStatus.COMPLETED);
      expect(next.status).toBe(AppointmentStatus.CANCELLED);
      const cancelEvent = await prisma.queueEvent.findFirstOrThrow({
        where: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
          type: QueueEventType.APPOINTMENT_CANCELLED,
        },
        orderBy: { queueEventSequence: 'desc' },
      });
      expect(cancelEvent.previousPrimaryStatus).toBe(AppointmentStatus.CALLED);
    } else {
      expect(current.status).toBe(AppointmentStatus.CALLED);
      expect(next.status).toBe(AppointmentStatus.CANCELLED);
    }
    expect(next.servingOrderKey).toBeNull();
    expect(next.waitingPlacementType).toBeNull();
    expect(await prisma.appointment.count({ where: { practiceLocationId, serviceDate: dateValue(serviceDate), status: AppointmentStatus.CALLED } })).toBe(nextResult.status === 'fulfilled' ? 0 : 1);
  });

  async function createAppointment(serviceDate: string, queueNumber: number, overrides: AppointmentFixtureOverrides = {}, active = true) {
    const date = dateValue(serviceDate);
    const activeAppointmentKey = active
      ? createHash('sha256').update(`${scope}|${date.toISOString()}|${queueNumber}|cancel`).digest('hex')
      : null;
    return prisma.appointment.create({
      data: {
        bookingReference: `M7C-${scope.slice(0, 8)}-${queueNumber}-${serviceDate}`,
        practiceLocationId,
        serviceDate: date,
        estimatedServiceMinutes: 30,
        queueNumber,
        firstName: 'Cancel',
        lastName: `Patient${queueNumber}`,
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(queueNumber),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        activeAppointmentKey,
        ...overrides,
      },
    });
  }

  async function createStartedClinicDayWithTwoAppointments(serviceDate: string) {
    const now = new Date();
    await prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        status: ClinicDayStatus.STARTED,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const current = await createAppointment(serviceDate, 51, { status: AppointmentStatus.CALLED, servingOrderKey: null, waitingPlacementType: null, calledAt: now });
    const next = await createAppointment(serviceDate, 52, { status: AppointmentStatus.WAITING, servingOrderKey: new Prisma.Decimal(1), waitingPlacementType: WaitingPlacementType.ORDINARY });
    return { currentId: current.id, nextId: next.id };
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
