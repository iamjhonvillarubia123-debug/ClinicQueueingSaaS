import { ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

describe('SecretaryWorkspaceService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    practiceStaff: { findMany: jest.fn() },
    secretaryInvitation: { findMany: jest.fn() },
  };
  const service = new SecretaryWorkspaceService(
    prisma as unknown as PrismaService,
  );

  const eligibleSecretary = {
    id: 'secretary-1',
    email: 'secretary@example.test',
    role: UserRole.SECRETARY,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    emailVerifiedAt: new Date('2026-09-01T00:00:00Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns only the signed-in Secretary relationships and email invitations', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleSecretary);
    prisma.practiceStaff.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        isActive: true,
        activatedAt: new Date('2026-09-01T00:00:00Z'),
        practiceLocation: {
          id: 'clinic-1',
          name: 'North Clinic',
          addressLine1: '1 Main St',
          addressLine2: null,
          cityMunicipality: 'Davao City',
          province: null,
          timeZone: 'Asia/Manila',
          currentRegularPracticeStaffId: 'staff-1',
          doctorProfile: {
            user: { firstName: 'Maria', lastName: 'Doctor' },
          },
        },
        authorityBundles: [{ bundleType: 'QUEUE_AND_CLINIC_DAY_OPERATIONS' }],
        substituteSecretaryCoverages: [],
      },
    ]);
    prisma.secretaryInvitation.findMany.mockResolvedValue([
      {
        id: 'invite-1',
        requestedAssignmentType: 'CLINIC_SECRETARY',
        requestedAuthorityBundles: ['APPOINTMENTS_AND_PATIENT_INTAKE'],
        requestedCancelClinicDay: false,
        requestedCoverageMode: null,
        requestedFromServiceDate: null,
        requestedToServiceDate: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        practiceLocation: {
          id: 'clinic-2',
          name: 'South Clinic',
          doctorProfile: {
            user: { firstName: 'Jose', lastName: 'Doctor' },
          },
        },
      },
    ]);

    const result = await service.getWorkspace('secretary-1');
    expect(prisma.practiceStaff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'secretary-1',
          disconnectedAt: null,
        },
      }),
    );
    expect(prisma.secretaryInvitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          normalizedEmail: 'secretary@example.test',
          status: 'PENDING',
        }) as unknown,
      }),
    );
    expect(result.clinics[0]).toEqual(
      expect.objectContaining({
        clinicName: 'North Clinic',
        assignmentType: 'CLINIC_SECRETARY',
        doctorName: 'Maria Doctor',
      }),
    );
    expect(result.invitations[0]).toEqual(
      expect.objectContaining({ clinicName: 'South Clinic' }),
    );
  });

  it('allows an active verified Secretary to have a valid empty workspace', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleSecretary);
    prisma.practiceStaff.findMany.mockResolvedValue([]);
    prisma.secretaryInvitation.findMany.mockResolvedValue([]);

    await expect(service.getWorkspace('secretary-1')).resolves.toEqual({
      clinics: [],
      invitations: [],
    });
  });

  it.each([
    {
      label: 'non-Secretary',
      user: { ...eligibleSecretary, role: UserRole.DOCTOR },
    },
    {
      label: 'disabled Secretary',
      user: {
        ...eligibleSecretary,
        accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      },
    },
    {
      label: 'restricted Secretary',
      user: {
        ...eligibleSecretary,
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      },
    },
    {
      label: 'unverified Secretary',
      user: { ...eligibleSecretary, emailVerifiedAt: null },
    },
  ])('rejects $label workspace access', async ({ user }) => {
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(service.getWorkspace(user.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.practiceStaff.findMany).not.toHaveBeenCalled();
    expect(prisma.secretaryInvitation.findMany).not.toHaveBeenCalled();
  });
});
