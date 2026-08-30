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
            firstName: 'Jane',
            lastName: 'Reyes',
            email: 'jane@example.test',
            mobileNumber: '09183334444',
            role: 'SECRETARY',
            accountStatus: 'ACTIVE',
            emailVerifiedAt: activatedAt,
          },
          authorityBundles: [{ bundleType: 'QUEUE_CLINIC_DAY_OPERATIONS' }],
          substituteSecretaryCoverages: [],
        },
      ],
    });
    prisma.user.findMany.mockResolvedValue([]);

    const result = await service.getClinicStaff('doctor-1', 'clinic-1');

    expect(result.staffAssignments[0]).toEqual(
      expect.objectContaining({
        practiceStaffId: 'staff-1',
        assignedAt: activatedAt,
        isClinicSecretary: true,
        authorityBundles: ['QUEUE_CLINIC_DAY_OPERATIONS'],
      }),
    );
  });

  it('does not disclose candidates when the clinic is outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.getClinicStaff('doctor-1', 'clinic-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('limits existing candidates to verified active Secretaries associated with the Doctor', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
      staffAssignments: [],
    });
    prisma.user.findMany.mockResolvedValue([
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
        where: expect.objectContaining({
          role: 'SECRETARY',
          accountStatus: 'ACTIVE',
          emailVerifiedAt: { not: null },
          practiceStaffAssignments: {
            some: {
              practiceLocation: { doctorProfile: { userId: 'doctor-1' } },
            },
          },
        }),
      }),
    );
    expect(result.candidates).toEqual([
      expect.objectContaining({ userId: 'secretary-1', name: 'Maria Santos' }),
    ]);
  });

  it('rejects a non-canonical service date before reading staff', async () => {
    await expect(
      service.getStaff('doctor-1', 'clinic-1', '08/30/2026'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.practiceLocation.findFirst).not.toHaveBeenCalled();
  });

  it('does not disclose staff for a clinic outside Doctor ownership', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(
      service.getStaff('doctor-1', 'clinic-2', '2026-08-30'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps regular, operating, and general staff assignment roles distinct', async () => {
    const regular = {
      id: 'staff-regular',
      staffRole: 'SECRETARY',
      isActive: true,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      user: {
        id: 'user-regular',
        firstName: 'Maria',
        lastName: 'Santos',
        email: 'maria@example.test',
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
      },
    };
    const substitute = {
      id: 'staff-substitute',
      staffRole: 'SECRETARY',
      isActive: true,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      user: {
        id: 'user-substitute',
        firstName: 'Jane',
        lastName: 'Reyes',
        email: 'jane@example.test',
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
      },
    };
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: regular.id,
      currentRegularPracticeStaff: regular,
      staffAssignments: [regular, substitute],
      clinicDays: [
        {
          id: 'day-1',
          status: 'STARTED',
          operatingPracticeStaffId: substitute.id,
          operatingPracticeStaff: substitute,
        },
      ],
    });

    const result = await service.getStaff('doctor-1', 'clinic-1', '2026-08-30');

    expect(result.regularSecretary?.practiceStaffId).toBe(regular.id);
    expect(result.operatingSecretary?.practiceStaffId).toBe(substitute.id);
    expect(result.staffAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          practiceStaffId: regular.id,
          isRegular: true,
          isOperating: false,
        }),
        expect.objectContaining({
          practiceStaffId: substitute.id,
          isRegular: false,
          isOperating: true,
        }),
      ]),
    );
  });

  it('supports Doctor operation with no regular or operating Secretary', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      currentRegularPracticeStaffId: null,
      currentRegularPracticeStaff: null,
      staffAssignments: [],
      clinicDays: [],
    });

    const result = await service.getStaff('doctor-1', 'clinic-1', '2026-08-30');

    expect(result.regularSecretary).toBeNull();
    expect(result.operatingSecretary).toBeNull();
    expect(result.clinicDay).toBeNull();
    expect(result.staffAssignments).toEqual([]);
  });
});
