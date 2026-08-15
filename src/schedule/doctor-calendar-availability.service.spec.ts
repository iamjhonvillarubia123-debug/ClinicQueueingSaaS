import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DoctorCalendarRecurrenceType,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorCalendarAvailabilityService } from './doctor-calendar-availability.service';
import { ScheduleTimeService } from './schedule-time.service';

describe('DoctorCalendarAvailabilityService', () => {
  let service: DoctorCalendarAvailabilityService;

  const prismaServiceMock = {
    doctorCalendarRule: { findMany: jest.fn() },
  };

  const dbDate = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day));
  const dbTime = (hour: number, minute = 0) =>
    new Date(Date.UTC(1970, 0, 1, hour, minute));

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorCalendarAvailabilityService,
        ScheduleTimeService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(DoctorCalendarAvailabilityService);
  });

  it('blocks a whole-day single-date occurrence', async () => {
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([
      {
        recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
        startDate: dbDate(2026, 8, 17),
        endDate: null,
        timeZone: 'Asia/Manila',
        isWholeDay: true,
        startsAtLocal: null,
        endsAtLocal: null,
        monthlyDayOfMonth: null,
        weeklyWeekdays: [],
        occurrenceOverrides: [],
      },
    ]);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T01:00:00.000Z'),
        new Date('2026-08-17T09:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks a partial-day overlap but permits a non-overlapping interval', async () => {
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([
      {
        recurrenceType: DoctorCalendarRecurrenceType.DAILY,
        startDate: dbDate(2026, 8, 1),
        endDate: null,
        timeZone: 'Asia/Manila',
        isWholeDay: false,
        startsAtLocal: dbTime(12),
        endsAtLocal: dbTime(14),
        monthlyDayOfMonth: null,
        weeklyWeekdays: [],
        occurrenceOverrides: [],
      },
    ]);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T01:00:00.000Z'),
        new Date('2026-08-17T05:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T06:00:00.000Z'),
        new Date('2026-08-17T09:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('applies weekly weekday recurrence', async () => {
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([
      {
        recurrenceType: DoctorCalendarRecurrenceType.WEEKLY,
        startDate: dbDate(2026, 8, 1),
        endDate: null,
        timeZone: 'Asia/Manila',
        isWholeDay: true,
        startsAtLocal: null,
        endsAtLocal: null,
        monthlyDayOfMonth: null,
        weeklyWeekdays: [{ weekday: Weekday.MONDAY }],
        occurrenceOverrides: [],
      },
    ]);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T01:00:00.000Z'),
        new Date('2026-08-17T03:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-18T01:00:00.000Z'),
        new Date('2026-08-18T03:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('honors a specific occurrence override back to available', async () => {
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([
      {
        recurrenceType: DoctorCalendarRecurrenceType.DAILY,
        startDate: dbDate(2026, 8, 1),
        endDate: null,
        timeZone: 'Asia/Manila',
        isWholeDay: true,
        startsAtLocal: null,
        endsAtLocal: null,
        monthlyDayOfMonth: null,
        weeklyWeekdays: [],
        occurrenceOverrides: [
          { occurrenceDate: dbDate(2026, 8, 17), isAvailable: true },
        ],
      },
    ]);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T01:00:00.000Z'),
        new Date('2026-08-17T03:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });

  it('matches a calendar occurrence by the rule timezone, not the clinic date label', async () => {
    prismaServiceMock.doctorCalendarRule.findMany.mockResolvedValue([
      {
        recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
        startDate: dbDate(2026, 8, 16),
        endDate: null,
        timeZone: 'America/Los_Angeles',
        isWholeDay: false,
        startsAtLocal: dbTime(18, 30),
        endsAtLocal: dbTime(19, 30),
        monthlyDayOfMonth: null,
        weeklyWeekdays: [],
        occurrenceOverrides: [],
      },
    ]);

    await expect(
      service.assertAvailableForInterval(
        'doctor-profile-1',
        new Date('2026-08-17T01:00:00.000Z'),
        new Date('2026-08-17T03:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
