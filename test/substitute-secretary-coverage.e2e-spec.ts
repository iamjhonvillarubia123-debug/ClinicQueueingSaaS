import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { SubstituteSecretaryCoverageService } from './../src/practice-staff/substitute-secretary-coverage.service';
import { SubstituteSecretaryCoverageMode } from './../src/practice-staff/substitute-secretary-coverage.types';

describe('Substitute Secretary coverage controls (e2e)', () => {
  let prisma: PrismaService;
  let service: SubstituteSecretaryCoverageService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let firstSecretaryUserId: string;
  let secondSecretaryUserId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SubstituteSecretaryCoverageService(prisma);
    scope = randomUUID().replaceAll('-', '');

    const doctor = await prisma.user.create({
      data: {
        email: `f5-coverage-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Coverage',
        lastName: 'Doctor',
        mobileNumber: `0920${scope.slice(0, 7)}`,
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
        specialization: 'Coverage Testing',
        licenseNumber: `F5C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `F5 Coverage ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    firstSecretaryUserId = await createReadySecretary('first', '0921');
    secondSecretaryUserId = await createReadySecretary('second', '0922');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists an inclusive range independently of ClinicDay and replays idempotently', async () => {
    const request = {
      practiceLocationId,
      userId: firstSecretaryUserId,
      coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
      fromServiceDate: '2026-09-10',
      toServiceDate: '2026-09-12',
    };
    const first = await service.create(doctorUserId, request, `range-${scope}`);
    const replay = await service.create(
      doctorUserId,
      request,
      `range-${scope}`,
    );

    expect(replay).toEqual({
      created: true,
      replayed: true,
      coverageId: first.coverageId,
    });
    const [dates, clinicDays, coverages] = await Promise.all([
      prisma.substituteSecretaryCoverageDate.findMany({
        where: { coverageId: first.coverageId },
        orderBy: { serviceDate: 'asc' },
      }),
      prisma.clinicDay.count({
        where: {
          practiceLocationId,
          serviceDate: {
            gte: dateValue('2026-09-10'),
            lte: dateValue('2026-09-12'),
          },
        },
      }),
      prisma.substituteSecretaryCoverage.count({
        where: { id: first.coverageId },
      }),
    ]);
    expect(
      dates.map((item) => item.serviceDate.toISOString().slice(0, 10)),
    ).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(clinicDays).toBe(0);
    expect(coverages).toBe(1);
  });

  it('serializes concurrent overlap attempts at the clinic and Service-Date boundary', async () => {
    const settled = await Promise.allSettled([
      service.create(
        doctorUserId,
        {
          practiceLocationId,
          userId: firstSecretaryUserId,
          coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
          fromServiceDate: '2026-09-20',
          toServiceDate: '2026-09-20',
        },
        `overlap-a-${scope}`,
      ),
      service.create(
        doctorUserId,
        {
          practiceLocationId,
          userId: secondSecretaryUserId,
          coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
          fromServiceDate: '2026-09-20',
          toServiceDate: '2026-09-20',
        },
        `overlap-b-${scope}`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: {
          practiceLocationId,
          serviceDate: dateValue('2026-09-20'),
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
  });

  it('supersedes replacement coverage atomically and cancels the replacement', async () => {
    const original = await service.create(
      doctorUserId,
      {
        practiceLocationId,
        userId: firstSecretaryUserId,
        coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
        fromServiceDate: '2026-09-25',
        toServiceDate: '2026-09-25',
      },
      `replace-source-${scope}`,
    );
    const replacement = await service.replace(
      doctorUserId,
      {
        coverageId: original.coverageId,
        userId: secondSecretaryUserId,
        coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
        fromServiceDate: '2026-09-25',
        toServiceDate: '2026-09-26',
      },
      `replace-${scope}`,
    );

    const [oldCoverage, newCoverage, activeDates] = await Promise.all([
      prisma.substituteSecretaryCoverage.findUniqueOrThrow({
        where: { id: original.coverageId },
      }),
      prisma.substituteSecretaryCoverage.findUniqueOrThrow({
        where: { id: replacement.coverageId },
      }),
      prisma.substituteSecretaryCoverageDate.count({
        where: { coverageId: replacement.coverageId, status: 'ACTIVE' },
      }),
    ]);
    expect(oldCoverage.status).toBe('SUPERSEDED');
    expect(newCoverage.supersedesCoverageId).toBe(original.coverageId);
    expect(activeDates).toBe(2);

    const cancelled = await service.cancel(
      doctorUserId,
      { coverageId: replacement.coverageId },
      `cancel-${scope}`,
    );
    expect(cancelled.cancelled).toBe(true);
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: { coverageId: replacement.coverageId, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.substituteSecretaryCoverage.findUniqueOrThrow({
          where: { id: replacement.coverageId },
        })
      ).status,
    ).toBe('CANCELLED');
  });

  async function createReadySecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `f5-coverage-${label}-${scope.slice(0, 12)}@example.test`,
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
    await prisma.practiceStaff.create({
      data: {
        userId: user.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    return user.id;
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
