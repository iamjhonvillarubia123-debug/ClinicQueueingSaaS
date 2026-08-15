import { Test, TestingModule } from '@nestjs/testing';
import {
  PracticeLocationLifecycleStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolutionService } from './schedule-resolution.service';
import { ScheduleTimeService } from './schedule-time.service';

describe('ScheduleResolutionService', () => {
  let service: ScheduleResolutionService;

  const prismaServiceMock = {
    practiceLocation: { findUnique: jest.fn() },
    scheduleException: { findUnique: jest.fn() },
    practiceSchedule: { findUnique: jest.fn() },
  };

  const time = (hour: number, minute = 0) =>
    new Date(Date.UTC(1970, 0, 1, hour, minute, 0));

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaServiceMock.practiceLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      timeZone: 'Asia/Manila',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
    });
    prismaServiceMock.scheduleException.findUnique.mockResolvedValue(null);
    prismaServiceMock.practiceSchedule.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleResolutionService,
        ScheduleTimeService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(ScheduleResolutionService);
  });

  it('uses a date-specific exception instead of the recurring schedule', async () => {
    prismaServiceMock.scheduleException.findUnique.mockResolvedValue({
      isOpen: true,
      opensAtLocal: time(10),
      closesAtLocal: time(15),
      maximumOnlineBookingUntilLocal: time(12),
      maximumOperatingUntilLocal: time(16),
    });

    const result = await service.resolveConfiguredSchedule(
      'location-1',
      '2026-08-16',
    );

    expect(result.source).toBe('SCHEDULE_EXCEPTION');
    expect(result.opensAt?.toISOString()).toBe('2026-08-16T02:00:00.000Z');
    expect(result.closesAt?.toISOString()).toBe('2026-08-16T07:00:00.000Z');
    expect(
      prismaServiceMock.practiceSchedule.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('falls back to the recurring weekday schedule when no exception exists', async () => {
    prismaServiceMock.practiceSchedule.findUnique.mockResolvedValue({
      isOpen: true,
      opensAtLocal: time(9),
      closesAtLocal: time(17),
      maximumOnlineBookingUntilLocal: null,
      maximumOperatingUntilLocal: null,
    });

    const result = await service.resolveConfiguredSchedule(
      'location-1',
      '2026-08-17',
    );

    expect(result.source).toBe('PRACTICE_SCHEDULE');
    expect(result.isOpen).toBe(true);
    expect(prismaServiceMock.practiceSchedule.findUnique).toHaveBeenCalledWith({
      where: {
        practiceLocationId_weekday: {
          practiceLocationId: 'location-1',
          weekday: Weekday.MONDAY,
        },
      },
    });
  });

  it('treats a closed exception as a complete replacement', async () => {
    prismaServiceMock.scheduleException.findUnique.mockResolvedValue({
      isOpen: false,
      opensAtLocal: null,
      closesAtLocal: null,
      maximumOnlineBookingUntilLocal: null,
      maximumOperatingUntilLocal: null,
    });

    const result = await service.resolveConfiguredSchedule(
      'location-1',
      '2026-08-17',
    );

    expect(result.isOpen).toBe(false);
    expect(result.source).toBe('SCHEDULE_EXCEPTION');
    expect(
      prismaServiceMock.practiceSchedule.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('returns no planned schedule when neither exception nor recurring row exists', async () => {
    const result = await service.resolveConfiguredSchedule(
      'location-1',
      '2026-08-17',
    );

    expect(result).toEqual(
      expect.objectContaining({
        isOpen: false,
        source: 'NO_SCHEDULE',
        opensAt: null,
        closesAt: null,
      }),
    );
  });

  it('suppresses configured hours when the PracticeLocation is not ACTIVE', async () => {
    prismaServiceMock.practiceLocation.findUnique
      .mockResolvedValueOnce({
        lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
      })
      .mockResolvedValueOnce({ id: 'location-1', timeZone: 'Asia/Manila' });
    prismaServiceMock.practiceSchedule.findUnique.mockResolvedValue({
      isOpen: true,
      opensAtLocal: time(9),
      closesAtLocal: time(17),
      maximumOnlineBookingUntilLocal: null,
      maximumOperatingUntilLocal: null,
    });

    const result = await service.resolveOperationalSchedule(
      'location-1',
      '2026-08-17',
    );

    expect(result.isOpen).toBe(false);
    expect(result.opensAt).toBeNull();
    expect(result.closesAt).toBeNull();
  });
});
