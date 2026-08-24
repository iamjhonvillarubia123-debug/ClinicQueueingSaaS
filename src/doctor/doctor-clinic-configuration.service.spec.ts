import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BookingQuestionType, ServiceAvailabilityStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorClinicConfigurationService } from './doctor-clinic-configuration.service';

describe('DoctorClinicConfigurationService', () => {
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
    practiceLocationService: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    bookingQuestion: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService;
  const service = new DoctorClinicConfigurationService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.practiceLocation.findFirst as jest.Mock).mockResolvedValue({ id: 'location-1', lifecycleStatus: 'ACTIVE' });
    (prisma.practiceLocationService.findMany as jest.Mock).mockResolvedValue([{ id: 'service-1', name: 'Acceptance Test Service', durationMinutes: 15, status: ServiceAvailabilityStatus.ACTIVE }]);
    (prisma.bookingQuestion.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('returns effective clinic services to the owning Doctor', async () => {
    await expect(service.list('doctor-1', 'location-1')).resolves.toEqual(expect.objectContaining({ services: [expect.objectContaining({ name: 'Acceptance Test Service' })] }));
  });

  it('denies cross-owner clinic configuration access', async () => {
    (prisma.practiceLocation.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.list('other-doctor', 'location-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks material redefinition after a BookingQuestion has answer history', async () => {
    (prisma.bookingQuestion.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'question-1', questionText: 'Old meaning', helpText: null, type: BookingQuestionType.TEXT, isRequired: false, displayOrder: 0, isActive: true, estimatedMinutesAdjustment: 0, textMaximumLength: null, numberMinimum: null, numberMaximum: null, selectOptions: null })
      .mockResolvedValueOnce(null);
    (prisma.bookingQuestion.count as jest.Mock).mockResolvedValue(0);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ hasHistory: true }]);
    await expect(service.updateBookingQuestion('doctor-1', 'location-1', 'question-1', { questionText: 'New meaning', type: BookingQuestionType.TEXT, isRequired: false, displayOrder: 0, isActive: true })).rejects.toBeInstanceOf(ConflictException);
  });
});
