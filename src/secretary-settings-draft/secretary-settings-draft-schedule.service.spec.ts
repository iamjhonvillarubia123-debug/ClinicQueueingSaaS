import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';

describe('SecretarySettingsDraftScheduleService', () => {
  let service: SecretarySettingsDraftScheduleService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    secretarySettingsDraftPracticeSchedule: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (transaction: typeof prismaServiceMock) => unknown) =>
        callback(prismaServiceMock),
    );
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-1',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);
    prismaServiceMock.secretarySettingsDraftPracticeSchedule.upsert.mockResolvedValue({
      weekday: Weekday.MONDAY,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretarySettingsDraftScheduleService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(SecretarySettingsDraftScheduleService);
  });

  it('saves an open recurring schedule proposal without changing effective PracticeSchedule', async () => {
    await expect(
      service.upsertPracticeSchedule('secretary-1', 'draft-1', {
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: '09:00',
        closesAtLocal: '17:00',
        maximumOnlineBookingUntilLocal: '16:00',
        maximumOperatingUntilLocal: '18:30',
      }),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      weekday: Weekday.MONDAY,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftPracticeSchedule.upsert,
    ).toHaveBeenCalledTimes(1);
  });

  it('stores a closed proposal with all schedule times cleared', async () => {
    await service.upsertPracticeSchedule('secretary-1', 'draft-1', {
      weekday: Weekday.MONDAY,
      isOpen: false,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftPracticeSchedule.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          proposedIsOpen: false,
          proposedOpensAtLocal: null,
          proposedClosesAtLocal: null,
          proposedMaximumOnlineBookingUntilLocal: null,
          proposedMaximumOperatingUntilLocal: null,
        }),
      }),
    );
  });

  it('rejects an overnight recurring proposal in Version 1', async () => {
    await expect(
      service.upsertPracticeSchedule('secretary-1', 'draft-1', {
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: '18:00',
        closesAtLocal: '08:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects public cutoff outside the clinic schedule interval', async () => {
    await expect(
      service.upsertPracticeSchedule('secretary-1', 'draft-1', {
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: '09:00',
        closesAtLocal: '17:00',
        maximumOnlineBookingUntilLocal: '18:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies the outgoing Secretary after regular Secretary replacement', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-new',
        currentSecretaryUserId: 'secretary-new',
        currentAssignmentActive: true,
      },
    ]);

    await expect(
      service.upsertPracticeSchedule('secretary-old', 'draft-1', {
        weekday: Weekday.MONDAY,
        isOpen: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks edits while the draft is submitted', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.SUBMITTED,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-1',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);

    await expect(
      service.upsertPracticeSchedule('secretary-1', 'draft-1', {
        weekday: Weekday.MONDAY,
        isOpen: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
