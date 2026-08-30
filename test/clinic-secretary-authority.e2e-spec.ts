import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { PasswordSecurityService } from './../src/auth/security/password-security.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { ClinicSecretaryAuthorityService } from './../src/practice-staff/clinic-secretary-authority.service';
import { ClinicSecretaryAuthorityBundle } from './../src/practice-staff/secretary-authority.types';

describe('Clinic Secretary authority bundles (e2e)', () => {
  const password = 'F5-e2e-password';
  let prisma: PrismaService;
  let service: ClinicSecretaryAuthorityService;
  let doctorUserId: string;
  let practiceLocationId: string;
  let otherPracticeLocationId: string;
  let firstSecretaryUserId: string;
  let secondSecretaryUserId: string;
  let unverifiedSecretaryUserId: string;
  let secondSecretaryOtherClinicStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const passwords = new PasswordSecurityService();
    service = new ClinicSecretaryAuthorityService(prisma, passwords);
    scope = randomUUID().replaceAll('-', '');
    const passwordHash = await passwords.hash(password);

    const doctor = await prisma.user.create({
      data: {
        email: `f5-authority-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Authority',
        lastName: 'Doctor',
        mobileNumber: `0930${scope.slice(0, 7)}`,
        passwordHash,
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
        specialization: 'Authority Testing',
        licenseNumber: `F5A-${scope.slice(0, 12)}`,
      },
    });
    const [location, otherLocation] = await Promise.all([
      prisma.practiceLocation.create({
        data: {
          doctorProfileId: profile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: `F5 Authority ${scope.slice(0, 8)}`,
          timeZone: 'Asia/Manila',
        },
      }),
      prisma.practiceLocation.create({
        data: {
          doctorProfileId: profile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: `F5 Authority Other ${scope.slice(0, 8)}`,
          timeZone: 'Asia/Manila',
        },
      }),
    ]);
    practiceLocationId = location.id;
    otherPracticeLocationId = otherLocation.id;

    firstSecretaryUserId = await createSecretary('first', true, '0931');
    secondSecretaryUserId = await createSecretary('second', true, '0932');
    unverifiedSecretaryUserId = await createSecretary(
      'unverified',
      false,
      '0933',
    );
    const otherAssignment = await prisma.practiceStaff.create({
      data: {
        userId: secondSecretaryUserId,
        practiceLocationId: otherPracticeLocationId,
      },
    });
    secondSecretaryOtherClinicStaffId = otherAssignment.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects missing bundles and an unverified Secretary', async () => {
    await expect(
      service.assign(
        doctorUserId,
        {
          practiceLocationId,
          userId: firstSecretaryUserId,
          authorityBundles: [],
        },
        `missing-bundles-${scope}`,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.assign(
        doctorUserId,
        {
          practiceLocationId,
          userId: unverifiedSecretaryUserId,
          authorityBundles: [ClinicSecretaryAuthorityBundle.REPORTS_VIEW_ONLY],
        },
        `unverified-${scope}`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assigns only selected predefined bundles and keeps CANCEL_CLINIC_DAY separate', async () => {
    const bundles = [
      ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
      ClinicSecretaryAuthorityBundle.REPORTS_VIEW_ONLY,
    ];
    const result = await service.assign(
      doctorUserId,
      {
        practiceLocationId,
        userId: firstSecretaryUserId,
        authorityBundles: bundles,
      },
      `assign-${scope}`,
    );

    const [storedBundles, capabilities] = await Promise.all([
      prisma.practiceStaffAuthorityBundle.findMany({
        where: { practiceStaffId: result.practiceStaffId, status: 'ACTIVE' },
        orderBy: { bundleType: 'asc' },
      }),
      prisma.practiceStaffCapability.findMany({
        where: { practiceStaffId: result.practiceStaffId, status: 'ACTIVE' },
      }),
    ]);
    expect(storedBundles.map((item) => item.bundleType).sort()).toEqual(
      [...bundles].sort(),
    );
    expect(capabilities).toHaveLength(0);
  });

  it('replaces atomically, revokes the outgoing assignment, and keeps its User active', async () => {
    const before = await prisma.practiceLocation.findUniqueOrThrow({
      where: { id: practiceLocationId },
    });
    const outgoingStaffId = before.currentRegularPracticeStaffId!;
    const result = await service.replace(
      doctorUserId,
      {
        practiceLocationId,
        userId: secondSecretaryUserId,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.APPOINTMENTS_AND_PATIENT_INTAKE,
          ClinicSecretaryAuthorityBundle.CLINIC_CONFIGURATION_DRAFTING,
        ],
        password,
      },
      `replace-${scope}`,
    );

    const [location, outgoingStaff, outgoingUser, outgoingActiveBundles] =
      await Promise.all([
        prisma.practiceLocation.findUniqueOrThrow({
          where: { id: practiceLocationId },
        }),
        prisma.practiceStaff.findUniqueOrThrow({
          where: { id: outgoingStaffId },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: firstSecretaryUserId },
        }),
        prisma.practiceStaffAuthorityBundle.count({
          where: { practiceStaffId: outgoingStaffId, status: 'ACTIVE' },
        }),
      ]);
    expect(location.currentRegularPracticeStaffId).toBe(result.practiceStaffId);
    expect(outgoingStaff.isActive).toBe(false);
    expect(outgoingStaff.deactivatedAt).not.toBeNull();
    expect(outgoingUser.accountStatus).toBe(UserAccountStatus.ACTIVE);
    expect(outgoingActiveBundles).toBe(0);
  });

  it('removes only the clinic assignment and preserves the User and other-clinic assignment', async () => {
    await service.remove(
      doctorUserId,
      { practiceLocationId, password },
      `remove-${scope}`,
    );

    const [location, user, otherAssignment] = await Promise.all([
      prisma.practiceLocation.findUniqueOrThrow({
        where: { id: practiceLocationId },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: secondSecretaryUserId },
      }),
      prisma.practiceStaff.findUniqueOrThrow({
        where: { id: secondSecretaryOtherClinicStaffId },
      }),
    ]);
    expect(location.currentRegularPracticeStaffId).toBeNull();
    expect(user.accountStatus).toBe(UserAccountStatus.ACTIVE);
    expect(otherAssignment.isActive).toBe(true);
    expect(otherAssignment.practiceLocationId).toBe(otherPracticeLocationId);
  });

  async function createSecretary(
    label: string,
    verified: boolean,
    mobilePrefix: string,
  ) {
    const user = await prisma.user.create({
      data: {
        email: `f5-authority-${label}-${scope.slice(0, 12)}@example.test`,
        firstName: label,
        lastName: 'Secretary',
        mobileNumber: `${mobilePrefix}${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    return user.id;
  }
});
