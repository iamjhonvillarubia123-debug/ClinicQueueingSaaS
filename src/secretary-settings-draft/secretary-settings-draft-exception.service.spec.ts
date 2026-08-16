import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { SecretarySettingsDraftExceptionService } from './secretary-settings-draft-exception.service';

describe('SecretarySettingsDraftExceptionService', () => {
  let service: SecretarySettingsDraftExceptionService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    secretarySettingsDraftScheduleException: { upsert: jest.fn() },
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
    prismaServiceMock.secretarySettingsDraftScheduleException.upsert.mockResolvedValue(
      { serviceDate: new Date('2026-08-20T00:00:00.000Z') },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretarySettingsDraftExceptionService,
        ScheduleTimeService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(SecretarySettingsDraftExceptionService);
  });

  it('saves an open date-specific proposal without changing effective ScheduleException', async () => {
    await expect(
      service.upsertScheduleException('secretary-1', 'draft-1', {
        serviceDate: '2026-08-20',
        isOpen: true,
        opensAtLocal: '09:00',
        closesAtLocal: '13:00',
        maximumOnlineBookingUntilLocal: '12:30',
        maximumOperatingUntilLocal: '15:00',
      }),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      serviceDate: '2026-08-20',
    });

    expect(
      prismaServiceMock.secretarySettingsDraftScheduleException.upsert,
    ).toHaveBeenCalledWith({
      where: {
        secretarySettingsDraftId_serviceDate: {
          secretarySettingsDraftId: 'draft-1',
          serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        },
      },
      create: {
        secretarySettingsDraftId: 'draft-1',
        serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        proposedIsOpen: true,
        proposedOpensAtLocal: new Date('1970-01-01T09:00:00.000Z'),
        proposedClosesAtLocal: new Date('1970-01-01T13:00:00.000Z'),
        proposedMaximumOnlineBookingUntilLocal: new Date(
          '1970-01-01T12:30:00.000Z',
        ),
        proposedMaximumOperatingUntilLocal: new Date(
          '1970-01-01T15:00:00.000Z',
        ),
      },
      update: {
        proposedIsOpen: true,
        proposedOpensAtLocal: new Date('1970-01-01T09:00:00.000Z'),
        proposedClosesAtLocal: new Date('1970-01-01T13:00:00.000Z'),
        proposedMaximumOnlineBookingUntilLocal: new Date(
          '1970-01-01T12:30:00.000Z',
        ),
        proposedMaximumOperatingUntilLocal: new Date(
          '1970-01-01T15:00:00.000Z',
        ),
      },
    });
  });

  it('stores a closed exception proposal as a complete replacement with null times', async () => {
    await service.upsertScheduleException('secretary-1', 'draft-1', {
      serviceDate: '2026-08-20',
      isOpen: false,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftScheduleException.upsert,
    ).toHaveBeenCalledWith({
      where: {
        secretarySettingsDraftId_serviceDate: {
          secretarySettingsDraftId: 'draft-1',
          serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        },
      },
      create: {
        secretarySettingsDraftId: 'draft-1',
        serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        proposedIsOpen: false,
        proposedOpensAtLocal: null,
        proposedClosesAtLocal: null,
        proposedMaximumOnlineBookingUntilLocal: null,
        proposedMaximumOperatingUntilLocal: null,
      },
      update: {
        proposedIsOpen: false,
        proposedOpensAtLocal: null,
        proposedClosesAtLocal: null,
        proposedMaximumOnlineBookingUntilLocal: null,
        proposedMaximumOperatingUntilLocal: null,
      },
    });
  });

  it('rejects an invalid Service Date', async () => {
    await expect(
      service.upsertScheduleException('secretary-1', 'draft-1', {
        serviceDate: '2026-02-30',
        isOpen: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an overnight date-specific proposal in Version 1', async () => {
    await expect(
      service.upsertScheduleException('secretary-1', 'draft-1', {
        serviceDate: '2026-08-20',
        isOpen: true,
        opensAtLocal: '18:00',
        closesAtLocal: '08:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects public cutoff outside the exception clinic interval', async () => {
    await expect(
      service.upsertScheduleException('secretary-1', 'draft-1', {
        serviceDate: '2026-08-20',
        isOpen: true,
        opensAtLocal: '09:00',
        closesAtLocal: '13:00',
        maximumOnlineBookingUntilLocal: '14:00',
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
      service.upsertScheduleException('secretary-old', 'draft-1', {
        serviceDate: '2026-08-20',
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
      service.upsertScheduleException('secretary-1', 'draft-1', {
        serviceDate: '2026-08-20',
        isOpen: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
