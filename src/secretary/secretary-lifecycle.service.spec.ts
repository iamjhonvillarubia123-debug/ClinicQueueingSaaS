import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationNotificationType,
  CommandType,
  PracticeStaffCapabilityStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';

describe('SecretaryLifecycleService', () => {
  let service: SecretaryLifecycleService;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userSession: { updateMany: jest.fn() },
    clinicDay: { updateMany: jest.fn() },
    practiceLocation: { updateMany: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn() },
    practiceStaff: { updateMany: jest.fn() },
    applicationNotification: { create: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretaryLifecycleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(SecretaryLifecycleService);
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockReset();
  });

  it('disables a Secretary and removes current clinic authority atomically', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
    });
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'secretary-1' }])
      .mockResolvedValueOnce([
        {
          id: 'staff-1',
          practiceLocationId: 'location-1',
          doctorUserId: 'doctor-1',
        },
        {
          id: 'staff-2',
          practiceLocationId: 'location-2',
          doctorUserId: 'doctor-2',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          operatingPracticeStaffId: 'staff-1',
        },
      ]);

    await expect(service.disable('secretary-1', 'disable-key')).resolves.toEqual({
      disabled: true,
      replayed: false,
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'secretary-1' },
      data: { accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'secretary-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.practiceLocation.updateMany).toHaveBeenCalledWith({
      where: { currentRegularPracticeStaffId: { in: ['staff-1', 'staff-2'] } },
      data: { currentRegularPracticeStaffId: null },
    });
    expect(tx.clinicDay.updateMany).toHaveBeenCalledWith({
      where: { operatingPracticeStaffId: { in: ['staff-1', 'staff-2'] } },
      data: { operatingPracticeStaffId: null },
    });
    expect(tx.practiceStaffCapability.updateMany).toHaveBeenCalledWith({
      where: {
        practiceStaffId: { in: ['staff-1', 'staff-2'] },
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: 'secretary-1',
        revokedAt: expect.any(Date),
      },
    });
    expect(tx.practiceStaff.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['staff-1', 'staff-2'] }, isActive: true },
      data: { isActive: false },
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SECRETARY_DISABLE_ACCOUNT,
        actorUserId: 'secretary-1',
        accountUserId: 'secretary-1',
        createdAt: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(tx.applicationNotification.create).toHaveBeenCalledTimes(2);
    expect(tx.applicationNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientUserId: 'doctor-1',
        notificationType: ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED,
        affectedSecretaryUserId: 'secretary-1',
        practiceLocationId: 'location-1',
        commandIdempotencyId: 'command-1',
      }),
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('disables cleanly when the Secretary has no current assignment', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
    });
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'secretary-1' }])
      .mockResolvedValueOnce([]);

    await expect(service.disable('secretary-1', 'disable-key')).resolves.toEqual({
      disabled: true,
      replayed: false,
    });

    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.clinicDay.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationNotification.create).not.toHaveBeenCalled();
  });

  it('replays a committed Disable without repeating authority-loss effects', async () => {
    const fingerprint = createHash('sha256')
      .update(`${CommandType.SECRETARY_DISABLE_ACCOUNT}|secretary-1`, 'utf8')
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(service.disable('secretary-1', 'disable-key')).resolves.toEqual({
      disabled: true,
      replayed: true,
    });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationNotification.create).not.toHaveBeenCalled();
  });

  it('rejects a non-Secretary or non-ACTIVE lifecycle source state', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'doctor-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
    });

    await expect(service.disable('doctor-1', 'disable-key')).rejects.toThrow(
      ConflictException,
    );
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
