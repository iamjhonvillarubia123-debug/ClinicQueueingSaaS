import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorSettingsDraftReviewReadService } from './doctor-settings-draft-review-read.service';

describe('DoctorSettingsDraftReviewReadService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    secretarySettingsDraft: { findMany: jest.fn(), findFirst: jest.fn() },
  } as unknown as PrismaService;
  const service = new DoctorSettingsDraftReviewReadService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    (prisma.secretarySettingsDraft.findMany as jest.Mock).mockResolvedValue([
      { id: 'draft-1', status: SecretarySettingsDraftStatus.SUBMITTED },
    ]);
    (prisma.secretarySettingsDraft.findFirst as jest.Mock).mockResolvedValue({
      id: 'draft-1',
      status: SecretarySettingsDraftStatus.SUBMITTED,
      practiceLocation: { id: 'location-1' },
      proposedPracticeSchedules: [],
      proposedServices: [],
      proposedBookingQuestions: [],
      proposedScheduleExceptions: [],
    });
  });

  it('lists submitted drafts scoped to the eligible Doctor', async () => {
    await expect(service.listSubmitted('doctor-1')).resolves.toHaveLength(1);
    expect(prisma.secretarySettingsDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: SecretarySettingsDraftStatus.SUBMITTED,
          practiceLocation: { doctorProfile: { userId: 'doctor-1' } },
        }),
      }),
    );
  });

  it('denies non-Doctor review access', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    await expect(service.listSubmitted('secretary-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reveal a draft outside the Doctor ownership boundary', async () => {
    (prisma.secretarySettingsDraft.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.getSubmitted('doctor-1', 'other-draft')).rejects.toBeInstanceOf(NotFoundException);
  });
});
