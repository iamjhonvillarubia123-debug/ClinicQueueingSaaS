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
import { NextPatientService } from './../src/queue/next-patient.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('R3 queue authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let service: NextPatientService;
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
    service = new NextPatientService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleTimeService(),
    );
    scope = randomUUID().replaceAll('-', '');

    const doctor = await prisma.user.create({
      data: {
        email: `r3-authz-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Queue',
        lastName: 'Doctor',
        mobileNumber: `0950${scope.slice(0, 7)}`,
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
        licenseNumber: `R3A-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Authz ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regular = await createSecretary('regular', '0951');
    regularSecretaryUserId = regular.userId;
    regularPracticeStaffId = regular.practiceStaffId;
    const handoff = await createSecretary('handoff', '0952');
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
    const serviceDate = '2026-12-01';
    await createQueue(serviceDate, regularPracticeStaffId);

    await expect(
      service.advance(
        regularSecretaryUserId,
        dto(serviceDate),
        `missing-bundle-${scope}`,
      ),
    ).rejects.toThrow();
  });

  it('allows the regular Clinic Secretary when the queue operations bundle is active', async () => {
    const serviceDate = '2026-12-02';
    await grantQueueBundle();
    await createQueue(serviceDate, regularPracticeStaffId);

    await expect(
      service.advance(
        regularSecretaryUserId,
        dto(serviceDate),
        `active-bundle-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('allows a ClinicDay-specific handoff Secretary without regular Clinic Secretary bundles', async () => {
    const serviceDate = '2026-12-03';
    await createQueue(serviceDate, handoffPracticeStaffId);

    await expect(
      service.advance(
        handoffSecretaryUserId,
        dto(serviceDate),
        `handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-authz-${label}-${scope.slice(0, 12)}@example.test`,
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

  async function createQueue(serviceDate: string, operatingPracticeStaffId: string) {
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
    const activeAppointmentKey = createHash('sha256')
      .update(`${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`)
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `R3A-${scope.slice(0, 8)}-${queueNumber}-${discriminator}`,
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

  function dto(serviceDate: string): NextPatientDto {
    return {
      practiceLocationId,
      serviceDate,
      patientOutcome: NextPatientOutcome.COMPLETED,
    };
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
