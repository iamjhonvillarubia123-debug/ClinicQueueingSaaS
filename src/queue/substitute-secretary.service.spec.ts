import { createHash } from 'crypto';
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
    prismaServiceMock.commandIdempotency.create.mockResolvedValue({ id: 'cmd-1' });
    prismaServiceMock.clinicDay.update.mockResolvedValue({});
    prismaServiceMock.clinicDayOperatingStaffAudit.create.mockResolvedValue({});
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
  });

  it('assigns a substitute over the regular ClinicDay operator without changing regular location authority', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-regular',
          currentRegularPracticeStaffId: 'staff-regular',
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([readyStaff('staff-sub', 'secretary-sub')]);

    await expect(
      service.assign(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-sub' },
        'assign-sub-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: false,
      commandType: CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-sub' },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('replaces an active substitute without resetting ClinicDay runtime', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-sub-old',
          currentRegularPracticeStaffId: 'staff-regular',
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([readyStaff('staff-sub-new', 'secretary-new')]);

    await expect(
      service.replace(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-new' },
        'replace-sub-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: false,
      commandType: CommandType.CLINIC_DAY_REPLACE_SUBSTITUTE_SECRETARY,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-sub-new' },
    });
  });

  it('ends a substitute and restores the eligible current regular Secretary', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-sub',
          currentRegularPracticeStaffId: 'staff-regular',
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([readyStaff('staff-regular', 'secretary-regular')]);

    await expect(
      service.end(
        'doctor-1',
        { clinicDayId: 'clinic-day-1' },
        'end-sub-key',
      ),
    ).resolves.toEqual({
      ended: true,
      replayed: false,
      restoredRegularSecretary: true,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-regular' },
    });
  });

  it('ends a substitute to Doctor control when no current regular Secretary exists', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.DELAYED,
          operatingPracticeStaffId: 'staff-sub',
          currentRegularPracticeStaffId: null,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.end(
        'doctor-1',
        { clinicDayId: 'clinic-day-1' },
        'end-sub-key',
      ),
    ).resolves.toEqual({
      ended: true,
      replayed: false,
      restoredRegularSecretary: false,
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: null },
    });
  });

  it('replays a committed substitute assignment without repeating runtime or audit effects', async () => {
    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.CLINIC_DAY_ASSIGN_SUBSTITUTE_SECRETARY}|doctor-1|clinic-day-1|secretary-sub`,
        'utf8',
      )
      .digest('hex');
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-sub',
          currentRegularPracticeStaffId: 'staff-regular',
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.assign(
        'doctor-1',
        { clinicDayId: 'clinic-day-1', userId: 'secretary-sub' },
        'assign-sub-key',
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
