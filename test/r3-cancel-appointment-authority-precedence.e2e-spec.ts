import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { CommandIdempotencyService } from './../src/idempotency/command-idempotency.service';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { CancelAppointmentService } from './../src/queue/cancel-appointment.service';

describe('R3 CANCEL APPOINTMENT authorization (e2e)', () => {
  let prisma: PrismaService;
  let service: CancelAppointmentService;
  let doctorUserId: string;
  let secretaryUserId: string;
  let practiceStaffId: string;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const config = new ConfigService({
      MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-r3-cancel-key',
    });
    service = new CancelAppointmentService(
      prisma,
      new CommandIdempotencyService(),
      new NotificationPayloadService(config),
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-cancel-auth-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Cancel',
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
        licenseNumber: `R3CA-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Cancel Auth ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `r3-cancel-auth-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Regular',
        lastName: 'Secretary',
        mobileNumber: `0971${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    secretaryUserId = secretary.id;
    const staff = await prisma.practiceStaff.create({
      data: {
        userId: secretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    practiceStaffId = staff.id;
    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: practiceStaffId },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it('denies assigned regular Clinic Secretary when APPOINTMENTS_AND_PATIENT_INTAKE is missing', async () => {
    const appointment = await createAppointment('2026-12-21', 1);

    await expect(
      service.cancel(
        secretaryUserId,
        { appointmentId: appointment.id, reason: 'PATIENT_REQUESTED' },
        `missing-appointments-bundle-${scope}`,
      ),
    ).rejects.toThrow(
      'Clinic Secretary lacks Appointments and Patient Intake authority.',
    );
  });

  it('allows assigned regular Clinic Secretary with APPOINTMENTS_AND_PATIENT_INTAKE', async () => {
    await grantAppointmentsBundle();
    const appointment = await createAppointment('2026-12-22', 2);

    await expect(
      service.cancel(
        secretaryUserId,
        { appointmentId: appointment.id, reason: 'PATIENT_REQUESTED' },
        `appointments-bundle-${scope}`,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      appointmentId: appointment.id,
      status: AppointmentStatus.CANCELLED,
    });
  });

  it('continues to allow the owning Doctor without a Secretary authority bundle', async () => {
    const appointment = await createAppointment('2026-12-23', 3);

    await expect(
      service.cancel(
        doctorUserId,
        { appointmentId: appointment.id, reason: 'CLINIC_REQUESTED' },
        `doctor-cancel-${scope}`,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      appointmentId: appointment.id,
      status: AppointmentStatus.CANCELLED,
    });
  });

  async function grantAppointmentsBundle() {
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
        ${practiceStaffId},
        'APPOINTMENTS_AND_PATIENT_INTAKE'::"PracticeStaffAuthorityBundleType",
        'ACTIVE'::"PracticeStaffAuthorityBundleStatus",
        ${doctorUserId},
        ${now},
        ${now}
      )
    `);
  }

  async function createAppointment(serviceDate: string, queueNumber: number) {
    const date = dateValue(serviceDate);
    return prisma.appointment.create({
      data: {
        bookingReference: `R3CA-${scope.slice(0, 8)}-${queueNumber}-${serviceDate}`,
        practiceLocationId,
        serviceDate: date,
        estimatedServiceMinutes: 30,
        queueNumber,
        firstName: 'Cancel',
        lastName: `Patient${queueNumber}`,
        status: AppointmentStatus.WAITING,
        servingOrderKey: new Prisma.Decimal(queueNumber),
        waitingPlacementType: WaitingPlacementType.ORDINARY,
        activeAppointmentKey: createHash('sha256')
          .update(`${scope}|${date.toISOString()}|${queueNumber}|cancel-auth`)
          .digest('hex'),
      },
    });
  }
});

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
