import { PrismaService } from '../prisma/prisma.service';
import { SecretaryDirectoryService } from './secretary-directory.service';

describe('SecretaryDirectoryService', () => {
  const prisma = { practiceLocation: { findMany: jest.fn() } };
  const service = new SecretaryDirectoryService(
    prisma as unknown as PrismaService,
  );
  beforeEach(() => jest.clearAllMocks());
  it('scopes every clinic and Secretary row to the signed-in Doctor', async () => {
    prisma.practiceLocation.findMany.mockResolvedValue([]);
    await expect(service.getDoctorDirectory('doctor-1')).resolves.toEqual({
      assignments: [],
      pendingInvitations: [],
    });
    expect(prisma.practiceLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { doctorProfile: { userId: 'doctor-1' } },
      }),
    );
  });
  it('keeps clinic assignment roles and pending invitations distinct', async () => {
    prisma.practiceLocation.findMany.mockResolvedValue([
      {
        id: 'clinic-1',
        name: 'North Clinic',
        currentRegularPracticeStaffId: 'staff-1',
        staffAssignments: [
          {
            id: 'staff-1',
            isActive: true,
            activatedAt: new Date('2026-08-28T00:00:00Z'),
            deactivatedAt: null,
            user: {
              id: 'secretary-1',
              firstName: 'Jane',
              lastName: 'Reyes',
              email: 'jane@example.test',
              mobileNumber: '0918',
              role: 'SECRETARY',
              accountStatus: 'ACTIVE',
              emailVerifiedAt: new Date(),
            },
            substituteSecretaryCoverages: [],
          },
        ],
        secretaryInvitations: [
          {
            id: 'invite-1',
            firstName: 'Anna',
            lastName: 'Cruz',
            normalizedEmail: 'anna@example.test',
            mobileNumber: '0917',
            status: 'PENDING',
            createdAt: new Date(),
            expiresAt: new Date(),
          },
        ],
      },
    ]);
    const result = await service.getDoctorDirectory('doctor-1');
    expect(result.assignments[0]).toEqual(
      expect.objectContaining({
        isClinicSecretary: true,
        clinic: { id: 'clinic-1', name: 'North Clinic' },
      }),
    );
    expect(result.pendingInvitations[0]).toEqual(
      expect.objectContaining({ invitationId: 'invite-1', status: 'PENDING' }),
    );
  });
});
