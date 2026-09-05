import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  ClinicDayOperationalNoticeKind,
  ClinicDayOperationalNoticeStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { ClinicDayOperationalNoticeService } from './../src/queue/clinic-day-operational-notice.service';

describe('R3 operational notice authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let service: ClinicDayOperationalNoticeService;
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
    service = new ClinicDayOperationalNoticeService(
      prisma,
      new CommandIdempotencyService(),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-notice-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Notice',
        lastName: 'Doctor',
        mobileNumber: `0960${scope.slice(0, 7)}`,
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
        licenseNumber: `R3ON-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Notice ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const regular = await createSecretary('regular', '0961');
    regularSecretaryUserId = regular.userId;
    regularPracticeStaffId = regular.practiceStaffId;
    const handoff = await createSecretary('handoff', '0962');
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

  it('denies regular Clinic Secretary from starting an operational notice without queue authority', async () => {
    const serviceDate = '2026-12-28';
    await createClinicDay(serviceDate, regularPracticeStaffId);

    await expect(
      service.start(
        regularSecretaryUserId,
        {
          practiceLocationId,
          serviceDate,
          kind: ClinicDayOperationalNoticeKind.SERVING_BREAK,
          reason: 'Short operational pause',
          expectedResumeAt: new Date(Date.now() + 60_000).toISOString(),
        },
        `notice-missing-${scope}`,
      ),
    ).rejects.toThrow('Clinic Secretary lacks Queue and Clinic Day Operations authority.');
  });

  it('allows regular Clinic Secretary with active queue authority to start and end an operational notice', async () => {
    const serviceDate = '2026-12-29';
    await grantQueueBundle();
    await createClinicDay(serviceDate, regularPracticeStaffId);

    const started = await service.start(
      regularSecretaryUserId,
      {
        practiceLocationId,
        serviceDate,
        kind: ClinicDayOperationalNoticeKind.SERVING_BREAK,
        reason: 'Short operational pause',
        expectedResumeAt: new Date(Date.now() + 60_000).toISOString(),
      },
      `notice-active-${scope}`,
    );
    expect(started.notice.status).toBe(ClinicDayOperationalNoticeStatus.ACTIVE);

    await expect(
      service.end(
        regularSecretaryUserId,
        { noticeId: started.notice.id },
        `notice-end-active-${scope}`,
      ),
    ).resolves.toMatchObject({
      notice: { status: ClinicDayOperationalNoticeStatus.ENDED },
    });
  });

  it('allows ClinicDay-specific handoff Secretary without regular bundles to start and end a notice', async () => {
    const serviceDate = '2026-12-30';
    await createClinicDay(serviceDate, handoffPracticeStaffId);

    const started = await service.start(
      handoffSecretaryUserId,
      {
        practiceLocationId,
        serviceDate,
        kind: ClinicDayOperationalNoticeKind.SERVING_BREAK,
        reason: 'Short operational pause',
        expectedResumeAt: new Date(Date.now() + 60_000).toISOString(),
      },
      `notice-handoff-${scope}`,
    );
    expect(started.notice.status).toBe(ClinicDayOperationalNoticeStatus.ACTIVE);

    await expect(
      service.end(
        handoffSecretaryUserId,
        { noticeId: started.notice.id },
        `notice-end-handoff-${scope}`,
      ),
    ).resolves.toMatchObject({
      notice: { status: ClinicDayOperationalNoticeStatus.ENDED },
    });
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-notice-${label}-${scope.slice(0, 12)}@example.test`,
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

  async function createClinicDay(
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
