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
import { PrismaService } from './../src/prisma/prisma.service';
import { SubstituteSecretaryCoverageService } from './../src/practice-staff/substitute-secretary-coverage.service';
import { SubstituteSecretaryCoverageMode } from './../src/practice-staff/substitute-secretary-coverage.types';

describe('Substitute Secretary coverage continuity (e2e)', () => {
  let prisma: PrismaService;
  let service: SubstituteSecretaryCoverageService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let firstSecretaryUserId: string;
  let secondSecretaryUserId: string;
  let firstPracticeStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SubstituteSecretaryCoverageService(prisma);
    scope = randomUUID().replaceAll('-', '');

    const doctor = await prisma.user.create({
      data: {
        email: `r3-continuity-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Continuity',
        lastName: 'Doctor',
        mobileNumber: `0940${scope.slice(0, 7)}`,
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
        specialization: 'Continuity Testing',
        licenseNumber: `R3C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Continuity ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const first = await createReadySecretary('first', '0941');
    firstSecretaryUserId = first.userId;
    firstPracticeStaffId = first.practiceStaffId;
    secondSecretaryUserId = (
      await createReadySecretary('second', '0942')
    ).userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('replacing and cancelling coverage leaves an existing live ClinicDay and queue untouched', async () => {
    const serviceDate = '2026-11-10';
    const date = dateValue(serviceDate);
    const startedAt = new Date('2026-11-10T01:15:00.000Z');
    const clinicDay = await prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: date,
        status: ClinicDayStatus.STARTED,
        operatingPracticeStaffId: firstPracticeStaffId,
        startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    });
    const called = await createAppointment(date, 41, 'CALLED', {
      status: AppointmentStatus.CALLED,
      calledAt: new Date('2026-11-10T01:20:00.000Z'),
      servingOrderKey: null,
      waitingPlacementType: null,
    });
    const waiting = await createAppointment(date, 42, 'WAITING', {
      status: AppointmentStatus.WAITING,
      servingOrderKey: new Prisma.Decimal('7.5000000000'),
      waitingPlacementType: WaitingPlacementType.ORDINARY,
    });

    const original = await service.create(
      doctorUserId,
      {
        practiceLocationId,
        userId: firstSecretaryUserId,
        coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
        fromServiceDate: serviceDate,
        toServiceDate: serviceDate,
      },
      `continuity-create-${scope}`,
    );
    if (!original.coverageId) {
      throw new Error('Coverage creation was incomplete.');
    }

    const replacement = await service.replace(
      doctorUserId,
      {
        coverageId: original.coverageId,
        userId: secondSecretaryUserId,
        coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
        fromServiceDate: serviceDate,
        toServiceDate: serviceDate,
      },
      `continuity-replace-${scope}`,
    );
    if (!replacement.coverageId) {
      throw new Error('Coverage replacement was incomplete.');
    }

    await assertOperationalStateUnchanged(
      clinicDay.id,
      called.id,
      waiting.id,
      startedAt,
    );

    await service.cancel(
      doctorUserId,
      { coverageId: replacement.coverageId },
      `continuity-cancel-${scope}`,
    );

    await assertOperationalStateUnchanged(
      clinicDay.id,
      called.id,
      waiting.id,
      startedAt,
    );
  });

  async function assertOperationalStateUnchanged(
    clinicDayId: string,
    calledId: string,
    waitingId: string,
    startedAt: Date,
  ) {
    const [day, called, waiting] = await Promise.all([
      prisma.clinicDay.findUniqueOrThrow({ where: { id: clinicDayId } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: calledId } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: waitingId } }),
    ]);

    expect(day.id).toBe(clinicDayId);
    expect(day.status).toBe(ClinicDayStatus.STARTED);
    expect(day.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(day.operatingPracticeStaffId).toBe(firstPracticeStaffId);

    expect(called.status).toBe(AppointmentStatus.CALLED);
    expect(called.queueNumber).toBe(41);
    expect(called.servingOrderKey).toBeNull();

    expect(waiting.status).toBe(AppointmentStatus.WAITING);
    expect(waiting.queueNumber).toBe(42);
    expect(waiting.servingOrderKey?.toString()).toBe('7.5');
    expect(waiting.waitingPlacementType).toBe(WaitingPlacementType.ORDINARY);
  }

  async function createReadySecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-continuity-${label}-${scope.slice(0, 12)}@example.test`,
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
      .update(
        `${scope}|${serviceDate.toISOString()}|${queueNumber}|${discriminator}`,
      )
      .digest('hex');
    return prisma.appointment.create({
      data: {
        bookingReference: `R3C-${scope.slice(0, 8)}-${queueNumber}-${discriminator}`,
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
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
