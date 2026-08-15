import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PracticeLocationLifecycleStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrossLocationScheduleConflictService } from './cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { ScheduleResolutionService } from './schedule-resolution.service';

describe('CrossLocationScheduleConflictService', () => {
  let service: CrossLocationScheduleConflictService;

  const prismaServiceMock = {
    practiceLocation: { findMany: jest.fn() },
  };
  const scheduleResolutionMock = {
    resolveConfiguredSchedule: jest.fn(),
  };
  const doctorCalendarMock = {
    isAvailableForInterval: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([
      { id: 'location-2', timeZone: 'Asia/Manila' },
    ]);
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrossLocationScheduleConflictService,
        { provide: PrismaService, useValue: prismaServiceMock },
        { provide: ScheduleResolutionService, useValue: scheduleResolutionMock },
        {
          provide: DoctorCalendarAvailabilityService,
          useValue: doctorCalendarMock,
        },
      ],
    }).compile();

    service = module.get(CrossLocationScheduleConflictService);
  });

  it('rejects an actual-instant overlap with another active location', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-2',
      serviceDate: '2026-08-17',
      timeZone: 'Asia/Manila',
      isOpen: true,
      source: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-17T01:00:00.000Z'),
      closesAt: new Date('2026-08-17T09:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });

    await expect(
      service.assertNoConflictForInterval(
        'doctor-profile-1',
        'location-1',
        new Date('2026-08-17T08:00:00.000Z'),
        new Date('2026-08-17T10:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.practiceLocation.findMany).toHaveBeenCalledWith({
      where: {
        doctorProfileId: 'doctor-profile-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        id: { not: 'location-1' },
      },
      select: { id: true, timeZone: true },
      orderBy: { id: 'asc' },
    });
  });

  it('permits back-to-back clinic intervals because ranges are half-open', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-2',
      serviceDate: '2026-08-17',
      timeZone: 'Asia/Manila',
      isOpen: true,
      source: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-17T01:00:00.000Z'),
      closesAt: new Date('2026-08-17T08:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });

    await expect(
      service.assertNoConflictForInterval(
        'doctor-profile-1',
        'location-1',
        new Date('2026-08-17T08:00:00.000Z'),
        new Date('2026-08-17T10:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('resolves the other location service date in that location timezone', async () => {
    prismaServiceMock.practiceLocation.findMany.mockResolvedValue([
      { id: 'location-la', timeZone: 'America/Los_Angeles' },
    ]);
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-la',
      serviceDate: '2026-08-16',
      timeZone: 'America/Los_Angeles',
      isOpen: true,
      source: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-17T00:00:00.000Z'),
      closesAt: new Date('2026-08-17T03:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });

    await expect(
      service.assertNoConflictForInterval(
        'doctor-profile-1',
        'location-manila',
        new Date('2026-08-17T00:30:00.000Z'),
        new Date('2026-08-17T02:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(scheduleResolutionMock.resolveConfiguredSchedule).toHaveBeenCalledWith(
      'location-la',
      '2026-08-16',
      expect.anything(),
    );
  });

  it('does not reserve another location interval when Doctor Calendar blocks that clinic day', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-2',
      serviceDate: '2026-08-17',
      timeZone: 'Asia/Manila',
      isOpen: true,
      source: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-17T01:00:00.000Z'),
      closesAt: new Date('2026-08-17T09:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(false);

    await expect(
      service.assertNoConflictForInterval(
        'doctor-profile-1',
        'location-1',
        new Date('2026-08-17T08:00:00.000Z'),
        new Date('2026-08-17T10:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores closed or absent effective schedules at the other location', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-2',
      serviceDate: '2026-08-17',
      timeZone: 'Asia/Manila',
      isOpen: false,
      source: 'NO_SCHEDULE',
      opensAt: null,
      closesAt: null,
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });

    await expect(
      service.assertNoConflictForInterval(
        'doctor-profile-1',
        'location-1',
        new Date('2026-08-17T08:00:00.000Z'),
        new Date('2026-08-17T10:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();

    expect(doctorCalendarMock.isAvailableForInterval).not.toHaveBeenCalled();
  });
});
