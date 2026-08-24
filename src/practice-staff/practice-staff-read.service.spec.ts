import { PracticeStaffReadService } from './practice-staff-read.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PracticeStaffReadService', () => {
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findFirst: jest.fn() },
    practiceStaff: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
  } as unknown as PrismaService;

  let service: PracticeStaffReadService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PracticeStaffReadService(prisma);
    (prisma.doctorProfile.findUnique as jest.Mock).mockResolvedValue({ id: 'doctor-profile-1' });
    (prisma.practiceLocation.findFirst as jest.Mock).mockResolvedValue({ id: 'location-1', name: 'North Clinic', lifecycleStatus: 'ACTIVE', currentRegularPracticeStaffId: 'staff-1' });
  });

  it('returns the authoritative current regular Secretary for the owning Doctor', async () => {
    (prisma.practiceStaff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff-1', isActive: true, createdAt: new Date(), user: { id: 'secretary-1', email: 'secretary@example.com' } });
    const result = await service.getClinicStaffing('doctor-1', 'location-1');
    expect(result.regularSecretary).toEqual(expect.objectContaining({ id: 'staff-1' }));
  });

  it('resolves an exact existing eligible Secretary account without exposing a global directory', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'secretary-2', email: 'other@example.com', emailVerifiedAt: new Date(), accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' });
    const result = await service.resolveExistingSecretary('doctor-1', 'location-1', 'other@example.com');
    expect(result.eligible).toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ email: expect.any(Object) }) }));
  });
});
