import { createHash } from 'crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';

describe('PracticeLocationPermanentDeleteService', () => {
  let service: PracticeLocationPermanentDeleteService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    clinicDay: { findFirst: jest.fn(), update: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn() },
    practiceStaff: { updateMany: jest.fn() },
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
        PracticeLocationPermanentDeleteService,
        { provide: PrismaService, useValue: prismaServiceMock },
        {
          provide: PasswordSecurityService,
          useValue: passwordSecurityServiceMock,
        },
      ],
    }).compile();

    service = module.get(PracticeLocationPermanentDeleteService);
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
    prismaServiceMock.scheduledReminder.findMany.mockResolvedValue([]);
    prismaServiceMock.practiceLocation.update.mockResolvedValue({});
    prismaServiceMock.practiceStaffCapability.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaServiceMock.practiceStaff.updateMany.mockResolvedValue({ count: 1 });
  });

  function mockSuccessfulLockSequence() {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
          doctorUserId: 'doctor-1',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'staff-1' }]);
  }

  it('permanently deletes a resolved location and removes current staff authority', async () => {
    mockSuccessfulLockSequence();

    await expect(
      service.permanentlyDelete(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmPermanentDelete: true,
        },
        'delete-location-key',
      ),
    ).resolves.toEqual({ permanentlyDeleted: true, replayed: false });

    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: {
        lifecycleStatus: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
        currentRegularPracticeStaffId: null,
        isBookingEnabled: false,
      },
    });
    expect(prismaServiceMock.practiceStaff.updateMany).toHaveBeenCalledTimes(1);
  });

  it('blocks permanent delete while a ClinicDay is STARTED', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
          doctorUserId: 'doctor-1',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.clinicDay.findFirst.mockResolvedValue({
      id: 'started-1',
    });

    await expect(
      service.permanentlyDelete(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmPermanentDelete: true,
        },
        'delete-location-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('blocks permanent delete until future confirmed Appointments are resolved', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
          doctorUserId: 'doctor-1',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'appointment-1' }]);

    await expect(
      service.permanentlyDelete(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmPermanentDelete: true,
        },
        'delete-location-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaServiceMock.practiceStaff.updateMany).not.toHaveBeenCalled();
  });

  it('rejects permanent delete when current password is invalid', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
          doctorUserId: 'doctor-1',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([]);
    passwordSecurityServiceMock.verify.mockResolvedValue(false);

    await expect(
      service.permanentlyDelete(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'wrong-password',
          confirmPermanentDelete: true,
        },
        'delete-location-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
  });

  it('replays a committed permanent delete without repeating authority effects', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
          doctorUserId: 'doctor-1',
          timeZone: 'Asia/Manila',
        },
      ])
      .mockResolvedValueOnce([]);
    const fingerprint = createHash('sha256')
      .update('PRACTICE_LOCATION_DELETE|doctor-1|location-1|confirmed', 'utf8')
      .digest('hex');
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.permanentlyDelete(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'ignored-on-replay',
          confirmPermanentDelete: true,
        },
        'delete-location-key',
      ),
    ).resolves.toEqual({ permanentlyDeleted: true, replayed: true });

    expect(passwordSecurityServiceMock.verify).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceStaff.updateMany).not.toHaveBeenCalled();
  });
});