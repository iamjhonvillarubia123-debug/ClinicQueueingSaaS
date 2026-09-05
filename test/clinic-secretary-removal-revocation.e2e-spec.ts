import { randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
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
import { SubstituteSecretaryCoverageService } from './../src/practice-staff/substitute-secretary-coverage.service';
import { SubstituteSecretaryCoverageMode } from './../src/practice-staff/substitute-secretary-coverage.types';

describe('Clinic Secretary removal authority revocation (e2e)', () => {
  const password = 'R3-removal-password';
  let prisma: PrismaService;
  let authorityService: ClinicSecretaryAuthorityService;
  let coverageService: SubstituteSecretaryCoverageService;
  let doctorUserId: string;
  let secretaryUserId: string;
  let targetLocationId: string;
  let otherLocationId: string;
  let targetPracticeStaffId: string;
  let otherPracticeStaffId: string;
  let coverageId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const passwords = new PasswordSecurityService();
    authorityService = new ClinicSecretaryAuthorityService(prisma, passwords);
    coverageService = new SubstituteSecretaryCoverageService(prisma);
    scope = randomUUID().replaceAll('-', '');

    const doctor = await prisma.user.create({
      data: {
        email: `r3-removal-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Removal',
        lastName: 'Doctor',
        mobileNumber: `0950${scope.slice(0, 7)}`,
        passwordHash: await passwords.hash(password),
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
        specialization: 'Removal Testing',
        licenseNumber: `R3R-${scope.slice(0, 12)}`,
      },
    });
    const [targetLocation, otherLocation] = await Promise.all([
      prisma.practiceLocation.create({
        data: {
          doctorProfileId: profile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: `R3 Removal Target ${scope.slice(0, 8)}`,
          countryCode: 'PH',
          timeZone: 'Asia/Manila',
        },
      }),
      prisma.practiceLocation.create({
        data: {
          doctorProfileId: profile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: `R3 Removal Other ${scope.slice(0, 8)}`,
          countryCode: 'PH',
          timeZone: 'Asia/Manila',
        },
      }),
    ]);
    targetLocationId = targetLocation.id;
    otherLocationId = otherLocation.id;

    const secretary = await prisma.user.create({
      data: {
        email: `r3-removal-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Removal',
        lastName: 'Secretary',
        mobileNumber: `0951${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    secretaryUserId = secretary.id;

    otherPracticeStaffId = (
      await prisma.practiceStaff.create({
        data: {
          userId: secretary.id,
          practiceLocationId: otherLocation.id,
          isActive: true,
        },
      })
    ).id;

    const assignment = await authorityService.assign(
      doctorUserId,
      {
        practiceLocationId: targetLocationId,
        userId: secretaryUserId,
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
          ClinicSecretaryAuthorityBundle.REPORTS_VIEW_ONLY,
        ],
        requestedCancelClinicDay: true,
        password,
      },
      `r3-removal-assign-${scope}`,
    );
    if (!assignment.practiceStaffId) {
      throw new Error('Clinic Secretary assignment was incomplete.');
    }
    targetPracticeStaffId = assignment.practiceStaffId;

    const coverage = await coverageService.create(
      doctorUserId,
      {
        practiceLocationId: targetLocationId,
        userId: secretaryUserId,
        coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
        fromServiceDate: '2026-11-20',
        toServiceDate: '2026-11-22',
      },
      `r3-removal-coverage-${scope}`,
    );
    if (!coverage.coverageId) {
      throw new Error('Substitute coverage creation was incomplete.');
    }
    coverageId = coverage.coverageId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('requires Doctor password before removing the Clinic Secretary', async () => {
    await expect(
      authorityService.remove(
        doctorUserId,
        { practiceLocationId: targetLocationId, password: 'wrong-password' },
        `r3-removal-wrong-password-${scope}`,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const [assignment, activeBundles, activeCapabilities, activeCoverage] =
      await Promise.all([
        prisma.practiceStaff.findUniqueOrThrow({
          where: { id: targetPracticeStaffId },
        }),
        prisma.practiceStaffAuthorityBundle.count({
          where: { practiceStaffId: targetPracticeStaffId, status: 'ACTIVE' },
        }),
        prisma.practiceStaffCapability.count({
          where: { practiceStaffId: targetPracticeStaffId, status: 'ACTIVE' },
        }),
        prisma.substituteSecretaryCoverage.findUniqueOrThrow({
          where: { id: coverageId },
        }),
      ]);

    expect(assignment.isActive).toBe(true);
    expect(activeBundles).toBe(2);
    expect(activeCapabilities).toBe(1);
    expect(activeCoverage.status).toBe('ACTIVE');
  });

  it('revokes only the target clinic relationship authority and planned coverage', async () => {
    await authorityService.remove(
      doctorUserId,
      { practiceLocationId: targetLocationId, password },
      `r3-removal-success-${scope}`,
    );

    const [
      targetLocation,
      targetAssignment,
      otherAssignment,
      secretaryUser,
      activeBundles,
      activeCapabilities,
      coverage,
      activeCoverageDates,
    ] = await Promise.all([
      prisma.practiceLocation.findUniqueOrThrow({
        where: { id: targetLocationId },
      }),
      prisma.practiceStaff.findUniqueOrThrow({
        where: { id: targetPracticeStaffId },
      }),
      prisma.practiceStaff.findUniqueOrThrow({
        where: { id: otherPracticeStaffId },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: secretaryUserId } }),
      prisma.practiceStaffAuthorityBundle.count({
        where: { practiceStaffId: targetPracticeStaffId, status: 'ACTIVE' },
      }),
      prisma.practiceStaffCapability.count({
        where: { practiceStaffId: targetPracticeStaffId, status: 'ACTIVE' },
      }),
      prisma.substituteSecretaryCoverage.findUniqueOrThrow({
        where: { id: coverageId },
      }),
      prisma.substituteSecretaryCoverageDate.count({
        where: { coverageId, status: 'ACTIVE' },
      }),
    ]);

    expect(targetLocation.currentRegularPracticeStaffId).toBeNull();
    expect(targetAssignment.isActive).toBe(false);
    expect(targetAssignment.deactivatedAt).not.toBeNull();
    expect(activeBundles).toBe(0);
    expect(activeCapabilities).toBe(0);
    expect(coverage.status).toBe('CANCELLED');
    expect(coverage.endedByUserId).toBe(doctorUserId);
    expect(coverage.endedAt).not.toBeNull();
    expect(activeCoverageDates).toBe(0);

    expect(secretaryUser.accountStatus).toBe(UserAccountStatus.ACTIVE);
    expect(otherAssignment.isActive).toBe(true);
    expect(otherAssignment.practiceLocationId).toBe(otherLocationId);
  });
});
