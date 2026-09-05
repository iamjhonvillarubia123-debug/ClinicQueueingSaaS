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
import {
  NextPatientDto,
  NextPatientOutcome,
} from './../src/queue/dto/next-patient.dto';
import { UndoQueueDto } from './../src/queue/dto/undo-queue.dto';
import { NextPatientService } from './../src/queue/next-patient.service';
import { UndoQueueService } from './../src/queue/undo-queue.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('R3 UNDO authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let nextPatient: NextPatientService;
  let undoQueue: UndoQueueService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let regularSecretaryUserId: string;
  let regularPracticeStaffId: string;
  let handoffSecretaryUserId: string;
  let handoffPracticeStaffId: string;
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
        email: `r3-undo-authz-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Undo',
        lastName: 'Doctor',
        mobileNumber: `0965${scope.slice(0, 7)}`,
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
        licenseNumber: `R3U-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Undo Authz ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regular = await createSecretary('regular', '0966');
    regularSecretaryUserId = regular.userId;
    regularPracticeStaffId = regular.practiceStaffId;
    const handoff = await createSecretary('handoff', '0967');
    handoffSecretaryUserId = handoff.userId;
    handoffPracticeStaffId = handoff.practiceStaffId;

    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: regularPracticeStaffId },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('denies the regular Clinic Secretary when the queue operations bundle is missing', async () => {
    const serviceDate = '2026-12-11';
    await createUndoSource(serviceDate, regularPracticeStaffId);

    await expect(
      undoQueue.undo(
        regularSecretaryUserId,
        undoDto(serviceDate),
        `missing-bundle-${scope}`,
      ),
    ).rejects.toThrow(
      'Regular Clinic Secretary requires QUEUE_AND_CLINIC_DAY_OPERATIONS authority.',
    );
  });

  it('allows the regular Clinic Secretary when the queue operations bundle is active', async () => {
    const serviceDate = '2026-12-12';
    await grantQueueBundle();
    await createUndoSource(serviceDate, regularPracticeStaffId);

    await expect(
      undoQueue.undo(
        regularSecretaryUserId,
        undoDto(serviceDate),
        `active-bundle-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('allows a ClinicDay-specific handoff Secretary without regular Clinic Secretary bundles', async () => {
    const serviceDate = '2026-12-13';
    await createUndoSource(serviceDate, handoffPracticeStaffId);

    await expect(
      undoQueue.undo(
        handoffSecretaryUserId,
        undoDto(serviceDate),
        `handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-undo-authz-${label}-${scope.slice(0, 12)}@example.test`,
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

  async function grantQueueBundle() {
    const now = new Date();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "PracticeStaffAuthorityBundle" (
        "id",
        "practiceStaffId",
        "bundleType",
        "status",
        "grantedByUserId",
        "grantedAt",
        "createdAt"
      ) VALUES (
        ${randomUUID()},
        ${regularPracticeStaffId},
        'QUEUE_AND_CLINIC_DAY_OPERATIONS'::"PracticeStaffAuthorityBundleType",
        'ACTIVE'::"PracticeStaffAuthorityBundleStatus",
        ${doctorUserId},
        ${now},
        ${now}
      )
    `);
  }

  async function createUndoSource(
    serviceDate: string,
    operatingPracticeStaffId: string,
  ) {
    const date = dateValue(serviceDate);
    const now = new Date();
    await prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: date,
        status: ClinicDayStatus.STARTED,
        operatingPracticeStaffId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    await createAppointment(date, 1, 'CURRENT', {
      status: AppointmentStatus.CALLED,
      calledAt: now,
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    await createAppointment(date, 2, 'NEXT', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal(1),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    await nextPatient.advance(
      doctorUserId,
      nextDto(serviceDate),
      `source-${serviceDate}-${scope}`,
    );
  }

  async function createAppointment(
    serviceDate: Date,
    queueNumber: number,
    discriminator: string,
    overrides: {
      status: AppointmentStatus;
      calledAt?: Date;
      servingOrderKey: Prisma.Decimal | null;
      waitingPlacementType: WaitingPlacementType | null;
    },
  ) {
    const identitySeed = `${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`;
    const activeAppointmentKey = createHash('sha256')
      .update(identitySeed)
      .digest('hex');
    const mobileNumberHash = createHash('sha256')
      .update(`mobile|${identitySeed}`)
      .digest('hex');
    const mobileLastFour = queueNumber.toString().padStart(4, '0');
    return prisma.appointment.create({
      data: {
        bookingReference: `R3U-${scope.slice(0, 8)}-${serviceDate
          .toISOString()
          .slice(5, 10)
          .replace('-', '')}-${queueNumber}-${discriminator}`,
        practiceLocationId,
        serviceDate,
        estimatedServiceMinutes: 30,
        queueNumber,
        activeAppointmentKey,
        mobileNumberEncrypted: `test-encrypted-${identitySeed}`,
        mobileNumberHash,
        mobileNumberLastFour: mobileLastFour,
        firstName: 'Undo',
        lastName: discriminator,
        ...overrides,
      },
    });
  }

  function nextDto(serviceDate: string): NextPatientDto {
    return {
      practiceLocationId,
      serviceDate,
      patientOutcome: NextPatientOutcome.COMPLETED,
    };
  }

  function undoDto(serviceDate: string): UndoQueueDto {
    return { practiceLocationId, serviceDate };
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
