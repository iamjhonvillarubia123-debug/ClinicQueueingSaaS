import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { MobileNumberService } from './../src/security/mobile-number/mobile-number.service';
import { StaffAppointmentService } from './../src/booking/staff-appointment.service';

describe('R3 staff-assisted Appointment authorization precedence (e2e)', () => {
  let prisma: PrismaService;
  let service: StaffAppointmentService;
  let scope: string;
  let doctorUserId: string;
  let practiceLocationId: string;
  let regularSecretaryUserId: string;
  let regularPracticeStaffId: string;
  let handoffSecretaryUserId: string;
  let handoffPracticeStaffId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const idempotency = {
      normalizeKey: (value?: string) => value ?? 'r3-staff-appointment-key',
      deriveIdentity: () => 'a'.repeat(64),
      fingerprint: () => 'b'.repeat(64),
      acquireCommandLock: async () => undefined,
      findReplay: async () => null,
    } as unknown as CommandIdempotencyService;
    const mobile = {
      protect: () => ({
        encrypted: 'e2e-protected-mobile',
        hash: 'c'.repeat(64),
        lastFour: '0000',
      }),
    } as unknown as MobileNumberService;

    service = new StaffAppointmentService(
      prisma,
      idempotency,
      mobile,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-staff-appt-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Intake',
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
        specialization: 'Intake Authorization Testing',
        licenseNumber: `R3I-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Staff Appointment ${scope.slice(0, 8)}`,
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

  it('denies the regular Clinic Secretary without APPOINTMENTS_AND_PATIENT_INTAKE authority', async () => {
    const serviceDate = '2026-12-22';
    await createStartedClinicDay(serviceDate, regularPracticeStaffId);

    await expect(
      service.create(
        regularSecretaryUserId,
        dto(serviceDate),
        `regular-missing-${scope}`,
      ),
    ).rejects.toThrow(
      'Regular Clinic Secretary requires APPOINTMENTS_AND_PATIENT_INTAKE authority.',
    );
  });

  it('lets the regular Clinic Secretary with active intake authority pass the authorization gate', async () => {
    const serviceDate = '2026-12-23';
    await createStartedClinicDay(serviceDate, regularPracticeStaffId);
    const now = new Date();
    await prisma.practiceStaffAuthorityBundle.create({
      data: {
        practiceStaffId: regularPracticeStaffId,
        bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE',
        status: 'ACTIVE',
        grantedByUserId: doctorUserId,
        grantedAt: now,
        createdAt: now,
      },
    });

    await expect(
      service.create(
        regularSecretaryUserId,
        dto(serviceDate),
        `regular-active-${scope}`,
      ),
    ).rejects.toThrow('Selected Services are not available.');
  });

  it('preserves ClinicDay-specific handoff authority without a regular Secretary bundle', async () => {
    const serviceDate = '2026-12-24';
    await createStartedClinicDay(serviceDate, handoffPracticeStaffId);

    await expect(
      service.create(
        handoffSecretaryUserId,
        dto(serviceDate),
        `handoff-${scope}`,
      ),
    ).rejects.toThrow('Selected Services are not available.');
  });

  it('preserves owning Doctor authority without Secretary bundles', async () => {
    const serviceDate = '2026-12-25';
    await createStartedClinicDay(serviceDate, regularPracticeStaffId);

    await expect(
      service.create(doctorUserId, dto(serviceDate), `doctor-${scope}`),
    ).rejects.toThrow('Selected Services are not available.');
  });

  async function createSecretary(label: string, mobilePrefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `r3-staff-appt-${label}-${scope.slice(0, 12)}@example.test`,
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

  async function createStartedClinicDay(
    serviceDate: string,
    operatingPracticeStaffId: string,
  ) {
    await prisma.clinicDay.create({
      data: {
        practiceLocationId,
        serviceDate: dateValue(serviceDate),
        status: ClinicDayStatus.STARTED,
        startedAt: new Date(),
        operatingPracticeStaffId,
      },
    });
  }

  function dto(serviceDate: string) {
    return {
      practiceLocationId,
      serviceDate,
      firstName: 'Test',
      lastName: 'Patient',
      existingPatientResponse: 'NO' as const,
      mobileNumber: '09170000000',
      selectedServiceIds: [randomUUID()],
    };
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
