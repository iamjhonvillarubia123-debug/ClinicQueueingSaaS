import { ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeStaffRole,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretarySettingsDraftReadService } from './secretary-settings-draft-read.service';

describe('SecretarySettingsDraftReadService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    secretarySettingsDraft: { findUnique: jest.fn() },
  } as unknown as PrismaService;

  const service = new SecretarySettingsDraftReadService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    (prisma.secretarySettingsDraft.findUnique as jest.Mock).mockResolvedValue({
      id: 'draft-1',
      status: SecretarySettingsDraftStatus.DRAFT,
      practiceLocation: {
        id: 'location-1',
        currentRegularPracticeStaff: {
          userId: 'secretary-1',
          isActive: true,
          staffRole: PracticeStaffRole.SECRETARY,
        },
      },
      proposedPracticeSchedules: [],
      proposedServices: [],
      proposedBookingQuestions: [],
      proposedScheduleExceptions: [],
    });
  });

  it('returns the draft to the current regular Secretary', async () => {
    await expect(service.getDraft('secretary-1', 'draft-1')).resolves.toEqual(
      expect.objectContaining({ id: 'draft-1', status: SecretarySettingsDraftStatus.DRAFT }),
    );
  });

  it('denies a stale outgoing Secretary even if the draft survives', async () => {
    await expect(service.getDraft('old-secretary', 'draft-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
