import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  CommandType,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubstituteSecretaryService } from './substitute-secretary.service';

describe('SubstituteSecretaryService', () => {
  let service: SubstituteSecretaryService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    clinicDay: { update: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
  };

  const readyStaff = (id: string, userId: string) => ({
    id,
    userId,
    practiceLocationId: 'location-1',
    staffRole: PracticeStaffRole.SECRETARY,
    isActive: true,
    userRole: UserRole.SECRETARY,
    userAccountStatus: UserAccountStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-15T00:00:00.000Z'),
  });

  const clinicDay = (
    status: ClinicDayStatus,
    operatingPracticeStaffId: string | null,
  ) => ({
    id: 'clinic-day-1',
    practiceLocationId: 'location-1',
    serviceDate: new Date('2026-08-15T00:00:00.000Z'),
    status,
    operatingPracticeStaffId,
    doctorUserId: 'doctor-1',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubstituteSecretaryService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();

    service = module.get(SubstituteSecretaryService);
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
    prismaServiceMock.clinicDay.update.mockResolvedValue({});
    prismaServiceMock.clinicDayOperatingStaffAudit.create.mockResolvedValue({});
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
  });

  it('assigns an operationally ready regular PracticeStaff member as the initial Operating Secretary', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.NOT_STARTED, null),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        readyStaff('staff-regular', 'secretary-regular'),
      ]);

    await expect(
      service.assign(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-regular' },
        'assign-operating-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: false,
      commandType: CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-regular' },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.ASSIGNED,
        previousOperatingPracticeStaffId: null,
        newOperatingPracticeStaffId: 'staff-regular',
        actorUserId: 'doctor-1',
      }),
    });
  });

  it('rejects initial assignment when an Operating Secretary already exists', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.NOT_STARTED, 'staff-current'),
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.assign(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-new' },
        'assign-operating-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.clinicDay.update).not.toHaveBeenCalled();
  });

  it('replaces the Operating Secretary only on a started ClinicDay without resetting runtime state', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.STARTED, 'staff-old'),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([readyStaff('staff-new', 'secretary-new')]);

    await expect(
      service.replace(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-new' },
        'replace-operating-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: false,
      commandType: CommandType.CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-new' },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.REPLACED,
        previousOperatingPracticeStaffId: 'staff-old',
        newOperatingPracticeStaffId: 'staff-new',
      }),
    });
  });

  it('rejects replacement before the ClinicDay has started', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.NOT_STARTED, 'staff-old'),
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.replace(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-new' },
        'replace-operating-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.clinicDay.update).not.toHaveBeenCalled();
  });

  it('clears the Operating Secretary to Doctor control without restoring the regular Secretary', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.STARTED, 'staff-operating'),
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.end(
        'doctor-1',
        { clinicDayId: 'clinic-day-1' },
        'clear-operating-key',
      ),
    ).resolves.toEqual({
      cleared: true,
      replayed: false,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: null },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.CLEARED,
        previousOperatingPracticeStaffId: 'staff-operating',
        newOperatingPracticeStaffId: null,
      }),
    });
  });

  it('replays a committed Operating Secretary assignment without repeating mutation or audit effects', async () => {
    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY}|doctor-1|clinic-day-1|secretary-regular`,
        'utf8',
      )
      .digest('hex');
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        clinicDay(ClinicDayStatus.NOT_STARTED, 'staff-regular'),
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.assign(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-regular' },
        'assign-operating-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: true,
      commandType: CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY,
    });

    expect(prismaServiceMock.clinicDay.update).not.toHaveBeenCalled();
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
