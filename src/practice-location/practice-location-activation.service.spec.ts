import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrossLocationScheduleConflictService } from '../schedule/cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from '../schedule/doctor-calendar-availability.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { PracticeLocationActivationService } from './practice-location-activation.service';

describe('PracticeLocationActivationService', () => {
  let service: PracticeLocationActivationService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    practiceLocation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    practiceSchedule: { findMany: jest.fn() },
  };
  const scheduleResolutionMock = {
    resolveConfiguredSchedule: jest.fn(),
  };
  const doctorCalendarMock = {
    isAvailableForInterval: jest.fn(),
  };
  const crossLocationConflictMock = {
    assertNoConflictForInterval: jest.fn(),
  };
  const recurringScheduleConflictMock = {
    assertNoConflictForLocation: jest.fn(),
  };

  const time = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (transaction: typeof prismaServiceMock) => unknown) =>
        Promise.resolve(callback(prismaServiceMock)),
    );
    prismaServiceMock.$executeRaw.mockResolvedValue(1);
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue(null);
    prismaServiceMock.commandIdempotency.create.mockResolvedValue({
      id: 'cmd-1',
    });
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue(null);
    prismaServiceMock.practiceLocation.update.mockResolvedValue({
      id: 'location-1',
    });
    prismaServiceMock.practiceSchedule.findMany.mockResolvedValue([
      {
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: time(9),
        closesAtLocal: time(17),
      },
    ]);
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      practiceLocationId: 'location-1',
      serviceDate: '2026-08-17',
      timeZone: 'Asia/Manila',
      isOpen: true,
      source: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-17T01:00:00.000Z'),
      closesAt: new Date('2026-08-17T09:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(true);
    crossLocationConflictMock.assertNoConflictForInterval.mockResolvedValue(
      undefined,
    );
    recurringScheduleConflictMock.assertNoConflictForLocation.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationActivationService,
        ScheduleTimeService,
        { provide: PrismaService, useValue: prismaServiceMock },
        {
          provide: ScheduleResolutionService,
          useValue: scheduleResolutionMock,
        },
        {
          provide: DoctorCalendarAvailabilityService,
          useValue: doctorCalendarMock,
        },
        {
          provide: CrossLocationScheduleConflictService,
          useValue: crossLocationConflictMock,
        },
        {
          provide: RecurringScheduleConflictService,
          useValue: recurringScheduleConflictMock,
        },
      ],
    }).compile();
    service = module.get(PracticeLocationActivationService);
  });

  function arrangeLocation(status: PracticeLocationLifecycleStatus) {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorProfileId: 'doctor-profile-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: status,
          name: 'Clinic A',
          addressLine1: '123 Main St',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([{ id: 'doctor-1' }]);
  }

  it('activates a DRAFT location after recurring and concrete conflict validation', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DRAFT);

    await expect(
      service.activate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'activate-key',
      ),
    ).resolves.toEqual({ activated: true, replayed: false });

    expect(recurringScheduleConflictMock.assertNoConflictForLocation).toHaveBeenCalledWith(
      'doctor-profile-1',
      'location-1',
      'Asia/Manila',
      prismaServiceMock,
    );
    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE },
    });
    expect(
      crossLocationConflictMock.assertNoConflictForInterval,
    ).toHaveBeenCalledTimes(1);
  });

  it('blocks activation when recurring schedule validation conflicts', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DRAFT);
    recurringScheduleConflictMock.assertNoConflictForLocation.mockRejectedValue(
      new ConflictException('Recurring schedule conflict.'),
    );

    await expect(
      service.activate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'activate-recurring-conflict-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(scheduleResolutionMock.resolveConfiguredSchedule).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('reactivates only location eligibility from DISABLED', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DISABLED);

    await expect(
      service.reactivate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'reactivate-key',
      ),
    ).resolves.toEqual({ reactivated: true, replayed: false });

    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledTimes(1);
    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE },
    });
  });

  it('requires at least one open recurring clinic schedule', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DRAFT);
    prismaServiceMock.practiceSchedule.findMany.mockResolvedValue([]);

    await expect(
      service.activate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'activate-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('rejects activation when another active location has the same name and address', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DRAFT);
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-2',
    });

    await expect(
      service.activate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'activate-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.practiceSchedule.findMany).not.toHaveBeenCalled();
  });

  it('does not reactivate from a lifecycle state other than DISABLED', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.DRAFT);

    await expect(
      service.reactivate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'reactivate-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('replays a committed activation without repeating schedule effects', async () => {
    arrangeLocation(PracticeLocationLifecycleStatus.ACTIVE);
    const requestFingerprint = createHash('sha256')
      .update(
        `${CommandType.PRACTICE_LOCATION_ACTIVATE}|doctor-1|location-1`,
        'utf8',
      )
      .digest('hex');
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint,
    });

    await expect(
      service.activate(
        'doctor-1',
        { practiceLocationId: 'location-1' },
        'activate-key',
      ),
    ).resolves.toEqual({ activated: true, replayed: true });

    expect(prismaServiceMock.practiceSchedule.findMany).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
