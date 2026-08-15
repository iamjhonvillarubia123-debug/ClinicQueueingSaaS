import { createHash } from 'crypto';
import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';

describe('PracticeLocationLifecycleService', () => {
  let service: PracticeLocationLifecycleService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    clinicDay: { findFirst: jest.fn(), update: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
    practiceStaff: { findMany: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn() },
    scheduledReminder: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationOutbox: { findFirst: jest.fn(), updateMany: jest.fn() },
    practiceLocation: { update: jest.fn() },
  };

  const passwordSecurityServiceMock = {
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationLifecycleService,
        { provide: PrismaService, useValue: prismaServiceMock },
        {
          provide: PasswordSecurityService,
          useValue: passwordSecurityServiceMock,
        },
      ],
    }).compile();

    service = module.get(PracticeLocationLifecycleService);
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
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      passwordHash: 'stored-hash',
    });
    passwordSecurityServiceMock.verify.mockResolvedValue(true);
    prismaServiceMock.clinicDay.findFirst.mockResolvedValue(null);
    prismaServiceMock.scheduledReminder.findFirst.mockResolvedValue(null);
    prismaServiceMock.notificationOutbox.findFirst.mockResolvedValue(null);
    prismaServiceMock.practiceStaff.findMany.mockResolvedValue([
      { id: 'staff-regular' },
    ]);
    prismaServiceMock.scheduledReminder.findMany.mockResolvedValue([
      { id: 'reminder-1' },
    ]);
    prismaServiceMock.practiceStaffCapability.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaServiceMock.notificationOutbox.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaServiceMock.scheduledReminder.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaServiceMock.clinicDay.update.mockResolvedValue({});
    prismaServiceMock.clinicDayOperatingStaffAudit.create.mockResolvedValue(
      {},
    );
    prismaServiceMock.practiceLocation.update.mockResolvedValue({});
  });

  function mockActiveLocationAndOperatingDay() {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-16T00:00:00.000Z'),
          status: ClinicDayStatus.NOT_STARTED,
          operatingPracticeStaffId: 'staff-regular',
        },
      ]);
  }

  it('disables an ACTIVE location while preserving regular PracticeStaff assignment', async () => {
    mockActiveLocationAndOperatingDay();

    await expect(
      service.disable(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmDisable: true,
        },
        'disable-location-key',
      ),
    ).resolves.toEqual({ disabled: true, replayed: false });

    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED },
    });
    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: null },
    });
    expect(
      prismaServiceMock.practiceStaffCapability.updateMany,
    ).toHaveBeenCalledTimes(1);
    expect(prismaServiceMock.scheduledReminder.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(
      (prismaServiceMock.practiceStaff as { updateMany?: jest.Mock }).updateMany,
    ).toBeUndefined();
  });

  it('blocks disable while a STARTED ClinicDay exists', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.clinicDay.findFirst.mockResolvedValue({ id: 'started-1' });

    await expect(
      service.disable(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmDisable: true,
        },
        'disable-location-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('blocks disable when reminder delivery is already PROCESSING', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.scheduledReminder.findFirst.mockResolvedValue({
      id: 'processing-reminder',
    });

    await expect(
      service.disable(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmDisable: true,
        },
        'disable-location-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      prismaServiceMock.notificationOutbox.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('rejects disable when the Doctor current password is invalid', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);
    passwordSecurityServiceMock.verify.mockResolvedValue(false);

    await expect(
      service.disable(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'wrong-password',
          confirmDisable: true,
        },
        'disable-location-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('replays a committed disable without repeating continuity effects', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
          doctorUserId: 'doctor-1',
        },
      ])
      .mockResolvedValueOnce([]);
    const fingerprint = createHash('sha256')
      .update(
        'PRACTICE_LOCATION_DISABLE|doctor-1|location-1|confirmed',
        'utf8',
      )
      .digest('hex');
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.disable(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'ignored-on-replay',
          confirmDisable: true,
        },
        'disable-location-key',
      ),
    ).resolves.toEqual({ disabled: true, replayed: true });

    expect(passwordSecurityServiceMock.verify).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.scheduledReminder.updateMany).not.toHaveBeenCalled();
  });
});
