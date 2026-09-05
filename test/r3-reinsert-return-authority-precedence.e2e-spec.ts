import { createHash, randomUUID } from 'crypto';
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
import { QueueServingOrderPlacementService } from './../src/queue/queue-serving-order-placement.service';
import { ReturnToQueueService } from './../src/queue/return-to-queue.service';
import { StaffReinsertService } from './../src/queue/staff-reinsert.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('R3 reinsert/return authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let returnService: ReturnToQueueService;
  let reinsertService: StaffReinsertService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let regularNoBundleUserId: string;
  let regularNoBundleStaffId: string;
  let regularBundledUserId: string;
  let regularBundledStaffId: string;
  let handoffSecretaryUserId: string;
  let handoffPracticeStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const idempotency = new CommandIdempotencyService();
    const scheduleTime = new ScheduleTimeService();
    const placement = new QueueServingOrderPlacementService();
    returnService = new ReturnToQueueService(
      prisma,
      idempotency,
      scheduleTime,
      placement,
    );
    reinsertService = new StaffReinsertService(
      prisma,
      idempotency,
      scheduleTime,
      placement,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-reinsert-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Queue',
        lastName: 'Doctor',
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
        specialization: 'Authorization Testing',
        licenseNumber: `R3RR-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Reinsert Return ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regularNoBundle = await createSecretary('regular-no-bundle', '0971');
    regularNoBundleUserId = regularNoBundle.userId;
    regularNoBundleStaffId = regularNoBundle.practiceStaffId;

    const regularBundled = await createSecretary('regular-bundled', '0972');
    regularBundledUserId = regularBundled.userId;
    regularBundledStaffId = regularBundled.practiceStaffId;
    await grantQueueBundle(regularBundledStaffId);

    const handoff = await createSecretary('handoff', '0973');
    handoffSecretaryUserId = handoff.userId;
    handoffPracticeStaffId = handoff.practiceStaffId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('denies regular Secretary RETURN TO QUEUE without queue authority', async () => {
    const serviceDate = '2027-01-04';
    await setRegularSecretary(regularNoBundleStaffId);
    await createClinicDay(serviceDate, regularNoBundleStaffId);
    const target = await createAppointment(
      serviceDate,
      1,
      'RETURN-MISSING',
      AppointmentStatus.OUT_FOR_PROCEDURE,
    );
    await expect(
      returnService.returnToQueue(
        regularNoBundleUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `return-missing-${scope}`,
      ),
    ).rejects.toThrow(
      'Clinic Secretary lacks Queue and Clinic Day Operations authority.',
    );
  });

  it('allows regular Secretary RETURN TO QUEUE with active queue authority', async () => {
    const serviceDate = '2027-01-05';
    await setRegularSecretary(regularBundledStaffId);
    await createClinicDay(serviceDate, regularBundledStaffId);
    const target = await createAppointment(
      serviceDate,
      2,
      'RETURN-ACTIVE',
      AppointmentStatus.OUT_FOR_PROCEDURE,
    );
    await expect(
      returnService.returnToQueue(
        regularBundledUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `return-active-${scope}`,
      ),
    ).resolves.toMatchObject({
      appointmentId: target.id,
      status: AppointmentStatus.WAITING,
      waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
    });
  });

  it('allows handoff Secretary RETURN TO QUEUE without regular bundles', async () => {
    const serviceDate = '2027-01-06';
    await setRegularSecretary(regularBundledStaffId);
    await createClinicDay(serviceDate, handoffPracticeStaffId);
    const target = await createAppointment(
      serviceDate,
      3,
      'RETURN-HANDOFF',
      AppointmentStatus.OUT_FOR_PROCEDURE,
    );
    await expect(
      returnService.returnToQueue(
        handoffSecretaryUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `return-handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ appointmentId: target.id });
  });

  it('denies regular Secretary STAFF REINSERT without queue authority', async () => {
    const serviceDate = '2027-01-07';
    await setRegularSecretary(regularNoBundleStaffId);
    await createClinicDay(serviceDate, regularNoBundleStaffId);
    const target = await createAppointment(
      serviceDate,
      4,
      'REINSERT-MISSING',
      AppointmentStatus.TEMPORARILY_ABSENT,
    );
    await expect(
      reinsertService.reinsert(
        regularNoBundleUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `reinsert-missing-${scope}`,
      ),
    ).rejects.toThrow(
      'Clinic Secretary lacks Queue and Clinic Day Operations authority.',
    );
  });

  it('allows regular Secretary STAFF REINSERT with active queue authority', async () => {
    const serviceDate = '2027-01-08';
    await setRegularSecretary(regularBundledStaffId);
    await createClinicDay(serviceDate, regularBundledStaffId);
    const target = await createAppointment(
      serviceDate,
      5,
      'REINSERT-ACTIVE',
      AppointmentStatus.TEMPORARILY_ABSENT,
    );
    await expect(
      reinsertService.reinsert(
        regularBundledUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `reinsert-active-${scope}`,
      ),
    ).resolves.toMatchObject({
      appointmentId: target.id,
      status: AppointmentStatus.WAITING,
      waitingPlacementType: WaitingPlacementType.STAFF_REINSERT,
    });
  });

  it('allows handoff Secretary STAFF REINSERT without regular bundles', async () => {
    const serviceDate = '2027-01-09';
    await setRegularSecretary(regularBundledStaffId);
    await createClinicDay(serviceDate, handoffPracticeStaffId);
    const target = await createAppointment(
      serviceDate,
      6,
      'REINSERT-HANDOFF',
      AppointmentStatus.TEMPORARILY_ABSENT,
    );
    await expect(
      reinsertService.reinsert(
        handoffSecretaryUserId,
        { practiceLocationId, serviceDate, appointmentId: target.id },
        `reinsert-handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ appointmentId: target.id });
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-reinsert-${label}-${scope.slice(0, 12)}@example.test`,
        firstName: label,
        lastName: 'Secretary',
        mobileNumber: `${mobilePrefix}${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
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

  async function setRegularSecretary(practiceStaffId: string) {
    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: practiceStaffId },
    });
  }

  async function createClinicDay(
    serviceDate: string,
    operatingPracticeStaffId: string,
  ) {
    const now = new Date();
    return prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        status: ClinicDayStatus.STARTED,
        operatingPracticeStaffId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async function createAppointment(
    serviceDate: string,
    queueNumber: number,
    discriminator: string,
    status: AppointmentStatus,
  ) {
    const date = dateValue(serviceDate);
    const activeAppointmentKey = createHash('sha256')
      .update(`${scope}|${serviceDate}|${queueNumber}|${discriminator}`)
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `R3RR-${scope.slice(0, 8)}-${queueNumber}-${discriminator}`,
        practiceLocationId,
        serviceDate: date,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        firstName: 'Queue',
        lastName: discriminator,
        status,
        servingOrderKey: null,
        waitingPlacementType: null,
      },
    });
  }

  async function grantQueueBundle(practiceStaffId: string) {
    const now = new Date();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "PracticeStaffAuthorityBundle" (
        "id", "practiceStaffId", "bundleType", "status",
        "grantedByUserId", "grantedAt", "createdAt"
      ) VALUES (
        ${randomUUID()},
        ${practiceStaffId},
        'QUEUE_AND_CLINIC_DAY_OPERATIONS'::"PracticeStaffAuthorityBundleType",
        'ACTIVE'::"PracticeStaffAuthorityBundleStatus",
        ${doctorUserId},
        ${now},
        ${now}
      )
    `);
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
