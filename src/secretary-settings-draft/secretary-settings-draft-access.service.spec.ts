import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretarySettingsDraftAccessService } from './secretary-settings-draft-access.service';

describe('SecretarySettingsDraftAccessService', () => {
  const prisma = {
    secretarySettingsDraft: { findUnique: jest.fn() },
    practiceLocation: { findFirst: jest.fn() },
  } as unknown as PrismaService;
  let service: SecretarySettingsDraftAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretarySettingsDraftAccessService(prisma);
    (prisma.secretarySettingsDraft.findUnique as jest.Mock).mockResolvedValue({ practiceLocationId: 'location-1' });
  });

  it('blocks Standard-only Secretary from creating configuration drafts', async () => {
    (prisma.practiceLocation.findFirst as jest.Mock).mockResolvedValue({
      currentRegularPracticeStaff: {
        canManageClinicDetails: false,
        canManageServices: false,
        canManageBookingQuestions: false,
        canManageSchedules: false,
      },
    });
    await expect(service.assertMayCreateDraft('secretary-1', 'location-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only the Custom configuration area explicitly granted', async () => {
    (prisma.practiceLocation.findFirst as jest.Mock).mockResolvedValue({
      currentRegularPracticeStaff: {
        canManageClinicDetails: false,
        canManageServices: true,
        canManageBookingQuestions: false,
        canManageSchedules: false,
      },
    });
    await expect(service.assertMayEditDraft('secretary-1', 'draft-1', 'SERVICES')).resolves.toBeUndefined();
    await expect(service.assertMayEditDraft('secretary-1', 'draft-1', 'SCHEDULES')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
