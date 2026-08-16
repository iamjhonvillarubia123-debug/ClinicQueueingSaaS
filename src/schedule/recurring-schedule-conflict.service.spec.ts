import { ConflictException } from '@nestjs/common';
import { Weekday } from '../../generated/prisma/client';
import { RecurringScheduleConflictService } from './recurring-schedule-conflict.service';
import { ScheduleTimeService } from './schedule-time.service';

describe('RecurringScheduleConflictService', () => {
  const prismaServiceMock = {
    practiceLocation: { findMany: jest.fn() },
    practiceSchedule: { findMany: jest.fn() },
  };
  const time = (hour: number, minute = 0) =>
    new Date(Date.UTC(1970, 0, 1, hour, minute));
  let service: RecurringScheduleConflictService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecurringScheduleConflictService(
      prismaServiceMock as never,
      new ScheduleTimeService(),
    );
  });

  it('rejects an exact weekly overlap for two Asia/Manila locations', async () => {
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([
      { id: 'location-2', timeZone: 'Asia/Manila' },
    ]);
    prismaServiceMock.practiceSchedule.findMany
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(9),
          closesAtLocal: time(12),
        },
      ])
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(11),
          closesAtLocal: time(15),
        },
      ]);

    await expect(
      service.assertNoConflictForLocation(
        'doctor-profile-1',
        'location-1',
        'Asia/Manila',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('permits back-to-back recurring hours in the same time zone', async () => {
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([
      { id: 'location-2', timeZone: 'Asia/Manila' },
    ]);
    prismaServiceMock.practiceSchedule.findMany
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(9),
          closesAtLocal: time(12),
        },
      ])
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(12),
          closesAtLocal: time(15),
        },
      ]);

    await expect(
      service.assertNoConflictForLocation(
        'doctor-profile-1',
        'location-1',
        'Asia/Manila',
      ),
    ).resolves.toBeUndefined();
  });

  it('detects a later cross-time-zone overlap caused by New York DST', async () => {
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([
      { id: 'location-ny', timeZone: 'America/New_York' },
    ]);
    prismaServiceMock.practiceSchedule.findMany
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(21, 15),
          closesAtLocal: time(21, 45),
        },
      ])
      .mockResolvedValueOnce([
        {
          weekday: Weekday.MONDAY,
          opensAtLocal: time(9),
          closesAtLocal: time(9, 30),
        },
      ]);

    await expect(
      service.assertNoConflictForLocation(
        'doctor-profile-1',
        'location-manila',
        'Asia/Manila',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ignores recurring schedules from inactive locations by querying ACTIVE locations only', async () => {
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([]);
    prismaServiceMock.practiceSchedule.findMany.mockResolvedValueOnce([
      {
        weekday: Weekday.MONDAY,
        opensAtLocal: time(9),
        closesAtLocal: time(12),
      },
    ]);

    await expect(
      service.assertNoConflictForLocation(
        'doctor-profile-1',
        'location-1',
        'Asia/Manila',
      ),
    ).resolves.toBeUndefined();

    expect(prismaServiceMock.practiceLocation.findMany).toHaveBeenCalledWith({
      where: {
        doctorProfileId: 'doctor-profile-1',
        lifecycleStatus: 'ACTIVE',
        id: { not: 'location-1' },
      },
      select: { id: true, timeZone: true },
      orderBy: { id: 'asc' },
    });
  });
});
