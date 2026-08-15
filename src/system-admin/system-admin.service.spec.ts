import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeAccountActionType,
  AdministrativeReasonCategory,
  AdministrativeRestrictionStatus,
  CommandType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemAdminService } from './system-admin.service';

describe('SystemAdminService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userSession: { updateMany: jest.fn() },
    administrativeAccountAction: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
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

  const service = new SystemAdminService(prisma, passwordSecurity);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
    tx.$executeRaw.mockResolvedValue(0);
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.administrativeAccountAction.create.mockResolvedValue({ id: 'action-1' });
    tx.administrativeAccountAction.findUnique.mockResolvedValue(null);
    tx.user.update.mockResolvedValue({});
    tx.userSession.updateMany.mockResolvedValue({ count: 2 });
    tx.commandIdempotency.create.mockResolvedValue({});
    passwordVerify.mockResolvedValue(true);
  });

  it('normally suspends a Doctor without changing voluntary accountStatus', async () => {
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
        accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      });

    await expect(
      service.normalSuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SERIOUS_POLICY_VIOLATION,
        'Verified policy violation.',
        'admin-password',
        'suspend-key',
      ),
    ).resolves.toEqual({
      suspended: true,
      replayed: false,
      administrativeAccountActionId: 'action-1',
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: {
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'doctor-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(tx.administrativeAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: AdministrativeAccountActionType.NORMAL_SUSPENSION,
        actorUserId: 'admin-1',
        targetDoctorUserId: 'doctor-1',
        reasonCategory: AdministrativeReasonCategory.SERIOUS_POLICY_VIOLATION,
        explanation: 'Verified policy violation.',
      }) as unknown,
      select: { id: true },
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SYSTEM_ADMIN_NORMAL_SUSPEND_DOCTOR,
        actorUserId: 'admin-1',
        accountUserId: 'doctor-1',
        resultAdministrativeAccountActionId: 'action-1',
      }) as unknown,
    });
  });

  it('requires fresh SYSTEM_ADMIN password step-up', async () => {
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
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      });
    passwordVerify.mockResolvedValue(false);

    await expect(
      service.normalSuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'wrong-password',
        'suspend-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
  });

  it('rejects a non-SYSTEM_ADMIN actor', async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-actor',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        passwordHash: 'hash',
      })
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      });

    await expect(
      service.normalSuspendDoctor(
        'doctor-actor',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'password',
        'suspend-key',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replays a committed normal suspension without repeating effects', async () => {
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
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      });

    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.SYSTEM_ADMIN_NORMAL_SUSPEND_DOCTOR}|admin-1|doctor-1|${AdministrativeReasonCategory.SECURITY_CONCERN}|Security review.`,
        'utf8',
      )
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultAdministrativeAccountActionId: 'action-1',
    });

    await expect(
      service.normalSuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'admin-password',
        'suspend-key',
      ),
    ).resolves.toEqual({
      suspended: true,
      replayed: true,
      administrativeAccountActionId: 'action-1',
    });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('normally restores SUSPENDED to NONE without changing voluntary accountStatus', async () => {
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
        accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      });
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'suspension-1', targetDoctorUserId: 'doctor-1' },
      ]);
    tx.administrativeAccountAction.create.mockResolvedValue({
      id: 'restoration-1',
    });

    await expect(
      service.normalRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Issue resolved after review.',
        'admin-password',
        'restore-key',
      ),
    ).resolves.toEqual({
      restored: true,
      replayed: false,
      administrativeAccountActionId: 'restoration-1',
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: {
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'doctor-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(tx.administrativeAccountAction.create).toHaveBeenCalledWith({
      data: {
        actionType: AdministrativeAccountActionType.NORMAL_RESTORATION,
        actorUserId: 'admin-1',
        targetDoctorUserId: 'doctor-1',
        reasonCategory: null,
        explanation: null,
        resolutionText: 'Issue resolved after review.',
        restoresActionId: 'suspension-1',
        occurredAt: expect.any(Date) as unknown,
      },
      select: { id: true },
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SYSTEM_ADMIN_NORMAL_RESTORE_DOCTOR,
        actorUserId: 'admin-1',
        accountUserId: 'doctor-1',
        resultAdministrativeAccountActionId: 'restoration-1',
      }) as unknown,
    });
  });

  it('rejects normal restoration from a non-SUSPENDED restriction state', async () => {
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
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED,
      });

    await expect(
      service.normalRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Resolved.',
        'admin-password',
        'restore-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
  });

  it('requires an unresolved NORMAL_SUSPENSION for the same Doctor', async () => {
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
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      });
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      service.normalRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Resolved.',
        'admin-password',
        'restore-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
  });

  it('replays committed normal restoration without creating duplicate effects', async () => {
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
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      });

    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.SYSTEM_ADMIN_NORMAL_RESTORE_DOCTOR}|admin-1|doctor-1|Issue resolved after review.`,
        'utf8',
      )
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultAdministrativeAccountActionId: 'restoration-1',
    });
    tx.administrativeAccountAction.findUnique.mockResolvedValue({
      actionType: AdministrativeAccountActionType.NORMAL_RESTORATION,
      targetDoctorUserId: 'doctor-1',
    });

    await expect(
      service.normalRestoreDoctor(
        'admin-1',
        'doctor-1',
        'Issue resolved after review.',
        'admin-password',
        'restore-key',
      ),
    ).resolves.toEqual({
      restored: true,
      replayed: true,
      administrativeAccountActionId: 'restoration-1',
    });

    expect(tx.administrativeAccountAction.findUnique).toHaveBeenCalledWith({
      where: { id: 'restoration-1' },
      select: { actionType: true, targetDoctorUserId: true },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
