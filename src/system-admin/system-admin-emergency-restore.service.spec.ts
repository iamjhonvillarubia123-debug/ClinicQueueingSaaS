import { createHash } from 'crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  AdministrativeAccountActionType,
  AdministrativeRestrictionStatus,
  CommandType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemAdminEmergencyRestoreService } from './system-admin-emergency-restore.service';

describe('SystemAdminEmergencyRestoreService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn() },
    userSession: { updateMany: jest.fn() },
    administrativeAccountAction: { create: jest.fn(), findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const passwordVerify = jest.fn().mockResolvedValue(true);
  const passwordSecurity = {
    verify: passwordVerify,
  } as unknown as PasswordSecurityService;
  const service = new SystemAdminEmergencyRestoreService(
    prisma,
    passwordSecurity,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(0);
    tx.$queryRaw.mockResolvedValue([]);
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.administrativeAccountAction.create.mockResolvedValue({
      id: 'restore-1',
    });
    tx.user.update.mockResolvedValue({});
    tx.userSession.updateMany.mockResolvedValue({ count: 1 });
    tx.commandIdempotency.create.mockResolvedValue({});
    passwordVerify.mockResolvedValue(true);
  });

  function arrangeTarget(status: AdministrativeRestrictionStatus) {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'admin-1',
        role: UserRole.SYSTEM_ADMIN,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        passwordHash: 'admin-hash',
      })
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: status,
      });
  }

  it('restores direct emergency suspension to NONE without reversing operational history', async () => {
    arrangeTarget(AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED);
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'emergency-1',
          targetDoctorUserId: 'doctor-1',
          occurredAt: new Date('2026-08-15T10:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.emergencyRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Emergency resolved.',
        'admin-password',
        'restore-key',
      ),
    ).resolves.toEqual({
      restored: true,
      replayed: false,
      administrativeAccountActionId: 'restore-1',
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: {
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    });
    expect(tx.administrativeAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: AdministrativeAccountActionType.EMERGENCY_RESTORATION,
        restoresActionId: 'emergency-1',
        resolutionText: 'Emergency resolved.',
      }) as unknown,
      select: { id: true },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalled();
  });

  it('restores emergency escalation back to unresolved SUSPENDED state', async () => {
    arrangeTarget(AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED);
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'emergency-1',
          targetDoctorUserId: 'doctor-1',
          occurredAt: new Date('2026-08-15T10:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([{ id: 'normal-1' }]);

    const result = await service.emergencyRestoreDoctor(
      'admin-1',
      'doctor-1',
      'Emergency resolved.',
      'admin-password',
      'restore-key',
    );
    expect(result.administrativeRestrictionStatus).toBe(
      AdministrativeRestrictionStatus.SUSPENDED,
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: {
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      },
    });
  });

  it('rejects restore from any state other than EMERGENCY_SUSPENDED', async () => {
    arrangeTarget(AdministrativeRestrictionStatus.SUSPENDED);
    await expect(
      service.emergencyRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Resolved.',
        'admin-password',
        'restore-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires fresh SYSTEM_ADMIN password step-up', async () => {
    arrangeTarget(AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED);
    passwordVerify.mockResolvedValue(false);
    await expect(
      service.emergencyRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Resolved.',
        'wrong-password',
        'restore-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('replays committed emergency restoration without applying effects again', async () => {
    arrangeTarget(AdministrativeRestrictionStatus.NONE);
    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.SYSTEM_ADMIN_EMERGENCY_RESTORE_DOCTOR}|admin-1|doctor-1|Emergency resolved.`,
        'utf8',
      )
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultAdministrativeAccountActionId: 'restore-1',
    });
    tx.administrativeAccountAction.findUnique.mockResolvedValue({
      id: 'restore-1',
      actionType: AdministrativeAccountActionType.EMERGENCY_RESTORATION,
      targetDoctorUserId: 'doctor-1',
    });

    await expect(
      service.emergencyRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Emergency resolved.',
        'admin-password',
        'restore-key',
      ),
    ).resolves.toEqual({
      restored: true,
      replayed: true,
      administrativeAccountActionId: 'restore-1',
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
  });
});
