import { ForbiddenException } from '@nestjs/common';
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

  beforeEach(() => jest.clearAllMocks());

  it('returns only the signed-in Secretary relationships and email invitations', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      email: 'secretary@example.test',
      role: 'SECRETARY',
    });
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

  it('rejects non-Secretary workspace access', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      email: 'doctor@example.test',
      role: 'DOCTOR',
    });
    await expect(service.getWorkspace('doctor-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
