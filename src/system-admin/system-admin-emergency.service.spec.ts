import { createHash } from 'crypto';
import {
  BadRequestException,
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
import { ClinicDayCancellationService } from '../queue/clinic-day-cancellation.service';
import { SystemAdminEmergencyService } from './system-admin-emergency.service';

describe('SystemAdminEmergencyService', () => {
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
    administrativeAccountActionScope: { count: jest.fn() },
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

  const cancelDoctorOperationsForEmergency = jest
    .fn()
    .mockResolvedValue({ stoppedClinicDayCount: 2 });
  const clinicCancellation = {
    cancelDoctorOperationsForEmergency,
  } as unknown as ClinicDayCancellationService;

  const service = new SystemAdminEmergencyService(
    prisma,
    passwordSecurity,
    clinicCancellation,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(0);
    tx.$queryRaw.mockResolvedValue([]);
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.administrativeAccountAction.create.mockResolvedValue({
      id: 'emergency-action-1',
    });
    tx.user.update.mockResolvedValue({});
    tx.userSession.updateMany.mockResolvedValue({ count: 1 });
    tx.commandIdempotency.create.mockResolvedValue({});
    tx.administrativeAccountActionScope.count.mockResolvedValue(2);
    passwordVerify.mockResolvedValue(true);
    cancelDoctorOperationsForEmergency.mockResolvedValue({
      stoppedClinicDayCount: 2,
    });
  });

  it('emergency suspends a Doctor and invokes Doctor-wide operational shutdown', async () => {
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

    await expect(
      service.emergencySuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SERIOUS_PLATFORM_SAFETY,
        'Immediate operational shutdown required.',
        'admin-password',
        true,
        'emergency-key',
      ),
    ).resolves.toEqual({
      emergencySuspended: true,
      replayed: false,
      administrativeAccountActionId: 'emergency-action-1',
      stoppedClinicDayCount: 2,
    });

    expect(tx.administrativeAccountAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: AdministrativeAccountActionType.EMERGENCY_SUSPENSION,
        actorUserId: 'admin-1',
        targetDoctorUserId: 'doctor-1',
        reasonCategory: AdministrativeReasonCategory.SERIOUS_PLATFORM_SAFETY,
      }) as unknown,
      select: { id: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: {
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.EMERGENCY_SUSPENDED,
      },
    });
    expect(cancelDoctorOperationsForEmergency).toHaveBeenCalledWith(
      tx,
      'doctor-1',
      'admin-1',
      'emergency-action-1',
      expect.any(Date) as unknown,
    );
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SYSTEM_ADMIN_EMERGENCY_SUSPEND_DOCTOR,
        actorUserId: 'admin-1',
        accountUserId: 'doctor-1',
        resultAdministrativeAccountActionId: 'emergency-action-1',
      }) as unknown,
    });
  });

  it('escalates an unresolved normal suspension without rewriting it', async () => {
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
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'normal-action-1', targetDoctorUserId: 'doctor-1' },
    ]);

    await expect(
      service.emergencySuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Escalation required.',
        'admin-password',
        true,
        'emergency-key',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ emergencySuspended: true, replayed: false }),
    );

    expect(tx.administrativeAccountAction.create).toHaveBeenCalledTimes(1);
  });

  it('requires explicit emergency-stop confirmation', async () => {
    await expect(
      service.emergencySuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'admin-password',
        false,
        'emergency-key',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      service.emergencySuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'wrong-password',
        true,
        'emergency-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(cancelDoctorOperationsForEmergency).not.toHaveBeenCalled();
  });

  it('replays the committed emergency result without rerunning shutdown', async () => {
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
    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.SYSTEM_ADMIN_EMERGENCY_SUSPEND_DOCTOR}|admin-1|doctor-1|${AdministrativeReasonCategory.SECURITY_CONCERN}|Security review.|confirmed`,
        'utf8',
      )
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
      resultAdministrativeAccountActionId: 'emergency-action-1',
    });
    tx.administrativeAccountAction.findUnique.mockResolvedValue({
      id: 'emergency-action-1',
      actionType: AdministrativeAccountActionType.EMERGENCY_SUSPENSION,
      targetDoctorUserId: 'doctor-1',
    });

    await expect(
      service.emergencySuspendDoctor(
        'admin-1',
        'doctor-1',
        AdministrativeReasonCategory.SECURITY_CONCERN,
        'Security review.',
        'admin-password',
        true,
        'emergency-key',
      ),
    ).resolves.toEqual({
      emergencySuspended: true,
      replayed: true,
      administrativeAccountActionId: 'emergency-action-1',
      stoppedClinicDayCount: 2,
    });

    expect(cancelDoctorOperationsForEmergency).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountAction.create).not.toHaveBeenCalled();
  });
});
