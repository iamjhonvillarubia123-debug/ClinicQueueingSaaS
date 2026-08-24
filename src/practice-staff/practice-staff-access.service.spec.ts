import { PracticeStaffCapabilityStatus, SecretaryAccessProfile } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeStaffAccessService } from './practice-staff-access.service';

describe('PracticeStaffAccessService', () => {
  const transaction = {
    practiceLocation: { findFirst: jest.fn() },
    practiceStaff: { findFirst: jest.fn(), update: jest.fn() },
    practiceStaffCapability: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof transaction) => unknown) => work(transaction)),
  } as unknown as PrismaService;

  let service: PracticeStaffAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PracticeStaffAccessService(prisma);
    transaction.practiceLocation.findFirst.mockResolvedValue({ id: 'location-1', currentRegularPracticeStaffId: 'staff-1' });
    transaction.practiceStaff.findFirst.mockResolvedValue({ id: 'staff-1' });
    transaction.practiceStaffCapability.findFirst.mockResolvedValue(null);
    transaction.practiceStaff.update.mockResolvedValue({});
    transaction.practiceStaffCapability.create.mockResolvedValue({});
    transaction.practiceStaffCapability.update.mockResolvedValue({});
  });

  it('normalizes Full clinic configuration to all proposal areas', async () => {
    await service.configure('doctor-1', {
      practiceLocationId: 'location-1', userId: 'secretary-1',
      accessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION,
      cancelClinicDay: false, assignDaySecretary: false,
    });
    expect(transaction.practiceStaff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessProfile: SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION,
        canManageClinicDetails: true,
        canManageServices: true,
        canManageBookingQuestions: true,
        canManageSchedules: true,
      }),
    }));
  });

  it('keeps Custom permissions explicit and grants exceptional authority separately', async () => {
    await service.configure('doctor-1', {
      practiceLocationId: 'location-1', userId: 'secretary-1',
      accessProfile: SecretaryAccessProfile.CUSTOM,
      canManageClinicDetails: false, canManageServices: true,
      canManageBookingQuestions: false, canManageSchedules: true,
      cancelClinicDay: false, assignDaySecretary: true,
    });
    expect(transaction.practiceStaff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ canManageServices: true, canManageSchedules: true, canManageClinicDetails: false }),
    }));
    expect(transaction.practiceStaffCapability.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ capabilityType: 'ASSIGN_DAY_SECRETARY', status: PracticeStaffCapabilityStatus.ACTIVE }),
    }));
  });
});
