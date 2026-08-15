import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

describe('SecretarySettingsDraftService', () => {
  let service: SecretarySettingsDraftService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    secretarySettingsDraft: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretarySettingsDraftService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();

    service = module.get(SecretarySettingsDraftService);
    jest.clearAllMocks();
    prismaServiceMock.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof prismaServiceMock) => Promise<unknown>,
      ) => callback(prismaServiceMock),
    );
    prismaServiceMock.$executeRaw.mockResolvedValue(1);
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue(null);
    prismaServiceMock.commandIdempotency.create.mockResolvedValue({
      id: 'cmd-1',
    });
  });

  it('creates a DRAFT for the current regular Secretary and preserves author assignment identity', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValueOnce([
      {
        practiceLocationId: 'location-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
        currentRegularPracticeStaffId: 'staff-current',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);
    prismaServiceMock.secretarySettingsDraft.findFirst.mockResolvedValue(null);
    prismaServiceMock.secretarySettingsDraft.create.mockResolvedValue({
      id: 'draft-1',
      practiceLocationId: 'location-1',
      authorPracticeStaffId: 'staff-current',
      status: SecretarySettingsDraftStatus.DRAFT,
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
      updatedAt: new Date('2026-08-15T00:00:00.000Z'),
    });

    const result = await service.create('secretary-1', {
      practiceLocationId: 'location-1',
    });

    expect(result.id).toBe('draft-1');
    expect(result.reused).toBe(false);
    expect(
      prismaServiceMock.secretarySettingsDraft.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('allows the new current regular Secretary to submit a surviving draft authored by the outgoing Secretary', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'draft-1',
          practiceLocationId: 'location-1',
          authorPracticeStaffId: 'staff-old',
          status: SecretarySettingsDraftStatus.RETURNED_FOR_REWORK,
        },
      ])
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-new',
          currentSecretaryUserId: 'secretary-new',
          currentAssignmentActive: true,
        },
      ]);
    prismaServiceMock.secretarySettingsDraft.update.mockResolvedValue({});

    const result = await service.submit('secretary-new', 'draft-1');

    expect(result.submitted).toBe(true);
    expect(result.draftId).toBe('draft-1');
    expect(result.status).toBe(SecretarySettingsDraftStatus.SUBMITTED);
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).toHaveBeenCalledTimes(1);
  });

  it('denies the outgoing Secretary after regular Secretary replacement', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'draft-1',
          practiceLocationId: 'location-1',
          authorPracticeStaffId: 'staff-old',
          status: SecretarySettingsDraftStatus.DRAFT,
        },
      ])
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-new',
          currentSecretaryUserId: 'secretary-new',
          currentAssignmentActive: true,
        },
      ]);

    await expect(
      service.submit('secretary-old', 'draft-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
  });

  it('lets the eligible owning Doctor return a submitted draft for rework without changing effective settings', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        authorPracticeStaffId: 'staff-old',
        status: SecretarySettingsDraftStatus.SUBMITTED,
      },
    ]);
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      doctorProfile: {
        practiceLocations: [{ id: 'location-1' }],
      },
    });
    prismaServiceMock.secretarySettingsDraft.update.mockResolvedValue({});

    await expect(
      service.returnForRework(
        'doctor-1',
        'draft-1',
        { reviewComment: 'Please revise clinic hours.' },
        'return-key',
      ),
    ).resolves.toEqual({
      reviewed: true,
      replayed: false,
      draftId: 'draft-1',
      status: SecretarySettingsDraftStatus.RETURNED_FOR_REWORK,
    });
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects a submitted draft terminally and records the protected review command', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        authorPracticeStaffId: 'staff-1',
        status: SecretarySettingsDraftStatus.SUBMITTED,
      },
    ]);
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      doctorProfile: {
        practiceLocations: [{ id: 'location-1' }],
      },
    });
    prismaServiceMock.secretarySettingsDraft.update.mockResolvedValue({});

    await expect(
      service.reject('doctor-1', 'draft-1', {}, 'reject-key'),
    ).resolves.toEqual({
      reviewed: true,
      replayed: false,
      draftId: 'draft-1',
      status: SecretarySettingsDraftStatus.REJECTED,
    });
    expect(prismaServiceMock.commandIdempotency.create).toHaveBeenCalledTimes(
      1,
    );
  });
});