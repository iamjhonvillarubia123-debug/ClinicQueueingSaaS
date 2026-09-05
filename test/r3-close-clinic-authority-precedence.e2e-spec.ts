import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { CloseClinicService } from './../src/queue/close-clinic.service';
import { ScheduleResolutionService } from './../src/schedule/schedule-resolution.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('R3 CLOSE CLINIC authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let service: CloseClinicService;
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
    const scheduleTime = new ScheduleTimeService();
    service = new CloseClinicService(
      prisma,
      new CommandIdempotencyService(),
      new ScheduleResolutionService(prisma, scheduleTime),
      scheduleTime,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-close-authz-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Close',
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
        licenseNumber: `R3CL-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Close Authz ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId,
        weekday: 'MONDAY',
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T00:00:00.000Z'),
        closesAtLocal: new Date('1970-01-01T00:01:00.000Z'),
        maximumOnlineBookingUntilLocal: new Date('1970-01-01T00:01:00.000Z'),
        maximumOperatingUntilLocal: new Date('1970-01-01T00:02:00.000Z'),
      },
    });

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
    const serviceDate = '2026-08-17';
    await createStartedClinicDay(serviceDate, regularPracticeStaffId);

    await expect(
      service.close(
        regularSecretaryUserId,
        { practiceLocationId, serviceDate },
        `missing-bundle-${scope}`,
      ),
    ).rejects.toThrow(
      'Clinic Secretary lacks Queue and Clinic Day Operations authority.',
    );
  });

  it('allows the regular Clinic Secretary when the queue operations bundle is active', async () => {
    const serviceDate = '2026-08-24';
    await grantQueueBundle();
    await createStartedClinicDay(serviceDate, regularPracticeStaffId);

    await expect(
      service.close(
        regularSecretaryUserId,
        { practiceLocationId, serviceDate },
        `active-bundle-${scope}`,
      ),
    ).resolves.toMatchObject({ status: ClinicDayStatus.CLOSED });
  });

  it('allows a ClinicDay-specific handoff Secretary without regular Clinic Secretary bundles', async () => {
    const serviceDate = '2026-08-31';
    await createStartedClinicDay(serviceDate, handoffPracticeStaffId);

    await expect(
      service.close(
        handoffSecretaryUserId,
        { practiceLocationId, serviceDate },
        `handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ status: ClinicDayStatus.CLOSED });
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-close-authz-${label}-${scope.slice(0, 12)}@example.test`,
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

  async function createStartedClinicDay(
    serviceDate: string,
    operatingPracticeStaffId: string,
  ) {
    const now = new Date();
    await prisma.clinicDay.create({
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
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
