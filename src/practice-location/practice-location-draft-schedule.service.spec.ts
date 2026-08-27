import { Test, TestingModule } from '@nestjs/testing';
import {
  PracticeLocationLifecycleStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationDraftScheduleService } from './practice-location-draft-schedule.service';

describe('PracticeLocationDraftScheduleService', () => {
  let service: PracticeLocationDraftScheduleService;

  const transactionMock = {
    practiceLocation: { findFirst: jest.fn() },
    practiceSchedule: { upsert: jest.fn(), findMany: jest.fn() },
    doctorPracticeScheduleDraft: { upsert: jest.fn() },
    doctorPracticeScheduleDraftRow: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const prismaMock = {
    doctorProfile: { findUnique: jest.fn() },
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        callback(transactionMock),
    ),
  };

  const schedules = Object.values(Weekday).map((weekday, index) => ({
    weekday,
    isOpen: index < 5,
    opensAtLocal: index < 5 ? '08:00' : undefined,
    closesAtLocal: index < 5 ? '17:00' : undefined,
    maximumOnlineBookingUntilLocal: index < 5 ? '15:00' : undefined,
    maximumOperatingUntilLocal: index < 5 ? '18:00' : '14:00',
  }));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationDraftScheduleService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(PracticeLocationDraftScheduleService);
    jest.clearAllMocks();
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    transactionMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });
    transactionMock.practiceSchedule.findMany.mockResolvedValue([]);
    transactionMock.doctorPracticeScheduleDraft.upsert.mockResolvedValue({
      id: 'doctor-draft-1',
    });
    transactionMock.doctorPracticeScheduleDraftRow.findMany.mockResolvedValue(
      [],
    );
  });

  it('atomically upserts all seven recurring rows for an owned DRAFT clinic', async () => {
    await service.replaceDraftSchedule('user-1', 'location-1', { schedules });

    expect(transactionMock.practiceSchedule.upsert).toHaveBeenCalledTimes(7);
    expect(transactionMock.practiceSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          practiceLocationId: 'location-1',
          isOpen: true,
          opensAtLocal: new Date('1970-01-01T08:00:00.000Z'),
          closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
          maximumOperatingUntilLocal: new Date('1970-01-01T18:00:00.000Z'),
        }) as unknown,
      }),
    );
  });

  it('stores an ACTIVE clinic schedule separately from the effective schedule', async () => {
    transactionMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
    });

    await service.replaceDraftSchedule('user-1', 'location-1', { schedules });

    expect(transactionMock.practiceSchedule.upsert).not.toHaveBeenCalled();
    expect(
      transactionMock.doctorPracticeScheduleDraft.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { practiceLocationId: 'location-1' } }),
    );
    expect(
      transactionMock.doctorPracticeScheduleDraftRow.deleteMany,
    ).toHaveBeenCalledWith({
      where: { doctorPracticeScheduleDraftId: 'doctor-draft-1' },
    });
    expect(
      transactionMock.doctorPracticeScheduleDraftRow.createMany,
    ).toHaveBeenCalledTimes(1);
  });
});
