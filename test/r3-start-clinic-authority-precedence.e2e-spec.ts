import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
  Weekday,
} from './../generated/prisma/client';
import { SubscriptionCommercialGateService } from './../src/financial/subscription-commercial-gate.service';
import { SubscriptionEntitlementService } from './../src/financial/subscription-entitlement.service';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { StartClinicService } from './../src/queue/start-clinic.service';
import { DoctorCalendarAvailabilityService } from './../src/schedule/doctor-calendar-availability.service';
import { ScheduleResolutionService } from './../src/schedule/schedule-resolution.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';

describe('R3 START CLINIC authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let service: StartClinicService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let regularSecretaryUserId: string;
  let regularPracticeStaffId: string;
  let handoffSecretaryUserId: string;
  let handoffPracticeStaffId: string;
  let substituteSecretaryUserId: string;
  let substitutePracticeStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const scheduleTime = new ScheduleTimeService();
    const scheduleResolution = new ScheduleResolutionService(prisma, scheduleTime);
    const entitlement = new SubscriptionEntitlementService(prisma);
    const commercialGate = new SubscriptionCommercialGateService(prisma, entitlement);
    service = new StartClinicService(
      prisma,
      new CommandIdempotencyService(),
      scheduleResolution,
      new DoctorCalendarAvailabilityService(prisma, scheduleTime),
      scheduleTime,
      commercialGate,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-start-authz-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Start',
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

    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctor.id },
    });
    await prisma.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        paidThrough: new Date('2026-12-31T00:00:00.000Z'),
        graceEndsAt: new Date('2027-01-07T00:00:00.000Z'),
      },
    });

    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Authorization Testing',
        licenseNumber: `R3S-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Start Authz ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regular = await createSecretary('regular', '0971');
    regularSecretaryUserId = regular.userId;
    regularPracticeStaffId = regular.practiceStaffId;
    const handoff = await createSecretary('handoff', '0972');
    handoffSecretaryUserId = handoff.userId;
    handoffPracticeStaffId = handoff.practiceStaffId;
    const substitute = await createSecretary('substitute', '0973');
    substituteSecretaryUserId = substitute.userId;
    substitutePracticeStaffId = substitute.practiceStaffId;

    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: regularPracticeStaffId },
    });

    for (const weekday of Object.values(Weekday)) {
      await prisma.practiceSchedule.create({
        data: {
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

  it('denies the regular Clinic Secretary when the queue operations bundle is missing', async () => {
    const serviceDate = '2026-12-14';

    await expect(
      service.start(
        regularSecretaryUserId,
        { practiceLocationId, serviceDate },
        `missing-bundle-${scope}`,
      ),
    ).rejects.toThrow(
      'Regular Clinic Secretary requires QUEUE_AND_CLINIC_DAY_OPERATIONS authority.',
    );
  });

  it('allows the regular Clinic Secretary with the active queue bundle when no substitute or handoff exists', async () => {
    const serviceDate = '2026-12-15';
    await grantQueueBundle();

    await expect(
      service.start(
        regularSecretaryUserId,
        { practiceLocationId, serviceDate },
        `regular-bundle-${scope}`,
      ),
    ).resolves.toMatchObject({ started: true, replayed: false });

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

  it('preserves an existing ClinicDay-specific handoff ahead of the regular secretary', async () => {
    const serviceDate = '2026-12-16';
    const now = new Date();
    await prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        status: ClinicDayStatus.NOT_STARTED,
        operatingPracticeStaffId: handoffPracticeStaffId,
        createdAt: now,
        updatedAt: now,
      },
    });

    await expect(
      service.start(
        handoffSecretaryUserId,
        { practiceLocationId, serviceDate },
        `handoff-${scope}`,
      ),
    ).resolves.toMatchObject({ started: true, replayed: false });

    const clinicDay = await prisma.clinicDay.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
        },
      },
    });
    expect(clinicDay.operatingPracticeStaffId).toBe(handoffPracticeStaffId);
  });

  it('gives active planned Substitute coverage precedence when the ClinicDay starts', async () => {
    const serviceDate = '2026-12-17';
    const now = new Date();
    await prisma.substituteSecretaryCoverage.create({
      data: {
        practiceLocationId,
        practiceStaffId: substitutePracticeStaffId,
        coverageMode: 'ONE_SERVICE_DATE',
        fromServiceDate: dateValue(serviceDate),
        toServiceDate: dateValue(serviceDate),
        createdByUserId: doctorUserId,
        createdAt: now,
        serviceDates: {
          create: {
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
            createdAt: now,
          },
        },
      },
    });

    await expect(
      service.start(
        substituteSecretaryUserId,
        { practiceLocationId, serviceDate },
        `substitute-${scope}`,
      ),
    ).resolves.toMatchObject({ started: true, replayed: false });

    const clinicDay = await prisma.clinicDay.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue(serviceDate),
        },
      },
    });
    expect(clinicDay.operatingPracticeStaffId).toBe(substitutePracticeStaffId);
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-start-authz-${label}-${scope.slice(0, 12)}@example.test`,
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
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function timeValue(hour: number, minute: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}
