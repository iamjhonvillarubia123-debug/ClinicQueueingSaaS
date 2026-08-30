import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubstituteSecretaryService } from './substitute-secretary.service';

type AuditInput = {
  data: {
    changeType: ClinicDayOperatingStaffChangeType;
    previousOperatingPracticeStaffId: string | null;
    newOperatingPracticeStaffId: string | null;
    actorUserId: string;
  };
};

describe('SubstituteSecretaryService', () => {
  let service: SubstituteSecretaryService;
  const auditCreateMock = jest.fn((input: AuditInput) =>
    Promise.resolve(input),
  );

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    clinicDay: { create: jest.fn(), update: jest.fn() },
    clinicDayOperatingStaffAudit: { create: auditCreateMock },
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
    lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
    doctorUserId: 'doctor-1',
  });

  const latestAudit = (): AuditInput['data'] => {
    const input = auditCreateMock.mock.calls[0]?.[0];
    if (!input) throw new Error('Expected an operating staff audit call.');
    return input.data;
  };

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
    prismaServiceMock.clinicDay.create.mockResolvedValue({
      id: 'clinic-day-1',
      practiceLocationId: 'location-1',
      serviceDate: new Date('2026-08-15T00:00:00.000Z'),
      status: ClinicDayStatus.NOT_STARTED,
      operatingPracticeStaffId: null,
    });
    prismaServiceMock.clinicDay.update.mockResolvedValue({});
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
  });

  it('does not create a future ClinicDay when assigning by service date', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.assign(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          serviceDate: '2026-08-15',
          userId: 'secretary-regular',
        },
        'assign-by-date-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaServiceMock.clinicDay.create).not.toHaveBeenCalled();
    expect(prismaServiceMock.clinicDay.update).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it('assigns an operationally ready regular PracticeStaff member as the initial Operating Secretary', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([clinicDay(ClinicDayStatus.NOT_STARTED, null)])
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
    expect(latestAudit()).toMatchObject({
      changeType: ClinicDayOperatingStaffChangeType.ASSIGNED,
      previousOperatingPracticeStaffId: null,
      newOperatingPracticeStaffId: 'staff-regular',
      actorUserId: 'doctor-1',
    });
  });

  it('rejects initial assignment when an Operating Secretary already exists', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
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
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([clinicDay(ClinicDayStatus.STARTED, 'staff-old')])
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
    expect(latestAudit()).toMatchObject({
      changeType: ClinicDayOperatingStaffChangeType.REPLACED,
      previousOperatingPracticeStaffId: 'staff-old',
      newOperatingPracticeStaffId: 'staff-new',
      actorUserId: 'doctor-1',
    });
  });

  it('rejects replacement before the ClinicDay has started', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
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
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
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
    ).resolves.toEqual({ cleared: true, replayed: false });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: null },
    });
    expect(latestAudit()).toMatchObject({
      changeType: ClinicDayOperatingStaffChangeType.CLEARED,
      previousOperatingPracticeStaffId: 'staff-operating',
      newOperatingPracticeStaffId: null,
      actorUserId: 'doctor-1',
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
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
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
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('acquires the clinic/date advisory lock before the ClinicDay row lock', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([clinicDay(ClinicDayStatus.NOT_STARTED, null)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        readyStaff('staff-regular', 'secretary-regular'),
      ]);

    await service.assign(
      'doctor-1',
      { clinicDayId: 'clinic-day-1', userId: 'secretary-regular' },
      'lock-order-key',
    );

    const scopeReadOrder =
      prismaServiceMock.$queryRaw.mock.invocationCallOrder[0];
    const scopeAdvisoryLockOrder =
      prismaServiceMock.$executeRaw.mock.invocationCallOrder[1];
    const clinicDayRowLockOrder =
      prismaServiceMock.$queryRaw.mock.invocationCallOrder[1];
    expect(scopeReadOrder).toBeLessThan(scopeAdvisoryLockOrder);
    expect(scopeAdvisoryLockOrder).toBeLessThan(clinicDayRowLockOrder);
  });
});
