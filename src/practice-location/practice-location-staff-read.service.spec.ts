import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationStaffReadService } from './practice-location-staff-read.service';

describe('PracticeLocationStaffReadService', () => {
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const service = new PracticeLocationStaffReadService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns date-independent staffing with effective activation time and authority', async () => {
    const activatedAt = new Date('2026-08-28T00:15:00.000Z');
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: 'staff-1',
      staffAssignments: [
        {
          id: 'staff-1',
          staffRole: 'SECRETARY',
          isActive: true,
          activatedAt,
          deactivatedAt: null,
          updatedAt: activatedAt,
          user: {
            id: 'secretary-1',
            firstName: 'Maria',
            lastName: 'Santos',
            email: 'maria@example.test',
            mobileNumber: '09172223333',
          },
          authorityBundles: [
            {
              id: 'bundle-1',
              bundleType: 'CLINIC_SECRETARY',
              status: 'ACTIVE',
              grantedAt: activatedAt,
              revokedAt: null,
            },
          ],
          substituteSecretaryCoverages: [],
        },
      ],
    });
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'secretary-2',
        firstName: 'Anna',
        lastName: 'Cruz',
        email: 'anna@example.test',
        mobileNumber: '09173334444',
      },
      {
        id: 'secretary-1',
        firstName: 'Maria',
        lastName: 'Santos',
        email: 'maria@example.test',
        mobileNumber: '09172223333',
      },
    ]);

    const result = await service.getClinicStaff('doctor-1', 'clinic-1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({
          role: 'SECRETARY',
          accountStatus: 'ACTIVE',
          emailVerifiedAt: { not: null },
          OR: expect.arrayContaining([
            {
              practiceStaffAssignments: {
                some: {
                  practiceLocation: { doctorProfile: { userId: 'doctor-1' } },
                },
              },
            },
            { secretaryInvitationAccepted: { practiceLocationId: 'clinic-1' } },
          ]),
        }),
      }),
    );
    expect(result).toEqual({
      practiceLocation: { id: 'clinic-1', name: 'North Clinic' },
      currentRegularPracticeStaffId: 'staff-1',
      assignments: [
        expect.objectContaining({
          practiceStaffId: 'staff-1',
          secretaryUserId: 'secretary-1',
          secretaryName: 'Maria Santos',
          effectiveFrom: activatedAt.toISOString(),
          activeAuthorityBundleTypes: ['CLINIC_SECRETARY'],
        }),
      ],
      eligibleExistingSecretaries: [
        {
          userId: 'secretary-2',
          firstName: 'Anna',
          lastName: 'Cruz',
          email: 'anna@example.test',
          mobileNumber: '09173334444',
        },
      ],
    });
  });

  it('rejects service-date-shaped read requests', async () => {
    await expect(
      service.getClinicStaff('doctor-1', 'clinic-1', '2026-08-28'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns not found when the Doctor does not own the clinic', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(
      service.getClinicStaff('doctor-1', 'clinic-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
