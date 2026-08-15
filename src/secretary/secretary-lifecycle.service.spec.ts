import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountPermanentClosureType,
  ApplicationNotificationType,
  CommandType,
  PracticeStaffCapabilityStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
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
    accountPermanentClosureAudit: { create: jest.fn() },
  };

  const prisma = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const passwordSecurity = {
    verify: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretaryLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordSecurityService, useValue: passwordSecurity },
      ],
    }).compile();
    service = module.get(SecretaryLifecycleService);
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockReset();
    passwordSecurity.verify.mockResolvedValue(true);
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

    await expect(
      service.disable('secretary-1', 'disable-key'),
    ).resolves.toEqual({
      disabled: true,
      replayed: false,
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'secretary-1' },
      data: { accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'secretary-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(tx.practiceLocation.updateMany).toHaveBeenCalledWith({
      where: {
        currentRegularPracticeStaffId: { in: ['staff-1', 'staff-2'] },
      },
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
        revokedAt: expect.any(Date) as unknown,
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
        createdAt: expect.any(Date) as unknown,
      }) as unknown,
      select: { id: true },
    });
    expect(tx.applicationNotification.create).toHaveBeenCalledTimes(2);
    expect(tx.applicationNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientUserId: 'doctor-1',
        notificationType:
          ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED,
        affectedSecretaryUserId: 'secretary-1',
        practiceLocationId: 'location-1',
        commandIdempotencyId: 'command-1',
      }) as unknown,
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

    await expect(
      service.disable('secretary-1', 'disable-key'),
    ).resolves.toEqual({
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

    await expect(
      service.disable('secretary-1', 'disable-key'),
    ).resolves.toEqual({
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

  it('reactivates only the Secretary account and restores no delegated clinic authority', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      passwordHash: 'hash',
    });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);

    await expect(
      service.reactivate(
        ' Secretary@Example.com ',
        'password',
        'reactivate-key',
      ),
    ).resolves.toEqual({ reactivated: true, replayed: false });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'secretary@example.com',
        role: UserRole.SECRETARY,
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });
    expect(passwordSecurity.verify).toHaveBeenCalledWith('password', 'hash');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'secretary-1' },
      data: { accountStatus: UserAccountStatus.ACTIVE },
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SECRETARY_REACTIVATE_ACCOUNT,
        actorUserId: null,
        accountUserId: 'secretary-1',
        createdAt: expect.any(Date) as unknown,
      }) as unknown,
    });
    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.practiceStaffCapability.updateMany).not.toHaveBeenCalled();
    expect(tx.clinicDay.updateMany).not.toHaveBeenCalled();
    expect(tx.practiceLocation.updateMany).not.toHaveBeenCalled();
    expect(tx.applicationNotification.create).not.toHaveBeenCalled();
  });

  it('rejects Secretary reactivation when the current password is invalid', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      passwordHash: 'hash',
    });
    passwordSecurity.verify.mockResolvedValue(false);

    await expect(
      service.reactivate('secretary@example.com', 'bad-password', 'key'),
    ).rejects.toThrow(UnauthorizedException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('replays a committed Secretary Reactivate without creating authority or sessions', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      passwordHash: 'hash',
    });
    const fingerprint = createHash('sha256')
      .update(`${CommandType.SECRETARY_REACTIVATE_ACCOUNT}|secretary-1`, 'utf8')
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.reactivate('secretary@example.com', 'password', 'reactivate-key'),
    ).resolves.toEqual({ reactivated: true, replayed: true });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.practiceStaffCapability.updateMany).not.toHaveBeenCalled();
  });

  it('rejects Reactivate from any state other than VOLUNTARILY_DISABLED', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      passwordHash: 'hash',
    });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);

    await expect(
      service.reactivate('secretary@example.com', 'password', 'key'),
    ).rejects.toThrow(ConflictException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('permanently closes an ACTIVE Secretary, clears live authority without closing ClinicDay, audits once, and notifies affected Doctors', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'secretary-1' }])
      .mockResolvedValueOnce([
        {
          id: 'staff-1',
          practiceLocationId: 'location-1',
          doctorUserId: 'doctor-1',
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
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      passwordHash: 'hash',
    });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command-delete-1' });

    await expect(
      service.permanentlyDelete(
        ' Secretary@Example.com ',
        'password',
        true,
        'delete-key',
      ),
    ).resolves.toEqual({ permanentlyClosed: true, replayed: false });

    expect(passwordSecurity.verify).toHaveBeenCalledWith('password', 'hash');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'secretary-1' },
      data: { accountStatus: UserAccountStatus.PERMANENTLY_CLOSED },
    });
    expect(tx.clinicDay.updateMany).toHaveBeenCalledWith({
      where: { operatingPracticeStaffId: { in: ['staff-1'] } },
      data: { operatingPracticeStaffId: null },
    });
    expect(tx.accountPermanentClosureAudit.create).toHaveBeenCalledWith({
      data: {
        accountUserId: 'secretary-1',
        initiatedByUserId: 'secretary-1',
        closureType: AccountPermanentClosureType.SECRETARY_PERMANENT_CLOSURE,
        previousAccountStatus: UserAccountStatus.ACTIVE,
        occurredAt: expect.any(Date) as unknown,
        commandIdempotencyId: 'command-delete-1',
      },
    });
    expect(tx.applicationNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientUserId: 'doctor-1',
        notificationType: ApplicationNotificationType.SECRETARY_ACCOUNT_DELETED,
        affectedSecretaryUserId: 'secretary-1',
        practiceLocationId: 'location-1',
        commandIdempotencyId: 'command-delete-1',
      }) as unknown,
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SECRETARY_DELETE_ACCOUNT,
        actorUserId: 'secretary-1',
        accountUserId: 'secretary-1',
      }) as unknown,
      select: { id: true },
    });
  });

  it('permanently closes a VOLUNTARILY_DISABLED Secretary without duplicating prior assignment-loss notifications', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'secretary-1' }])
      .mockResolvedValueOnce([]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      passwordHash: 'hash',
    });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command-delete-1' });

    await expect(
      service.permanentlyDelete(
        'secretary@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).resolves.toEqual({ permanentlyClosed: true, replayed: false });

    expect(tx.accountPermanentClosureAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousAccountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      }) as unknown,
    });
    expect(tx.applicationNotification.create).not.toHaveBeenCalled();
    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.clinicDay.updateMany).not.toHaveBeenCalled();
  });

  it('requires explicit irreversible confirmation before Secretary Permanent Delete', async () => {
    await expect(
      service.permanentlyDelete(
        'secretary@example.com',
        'password',
        false,
        'delete-key',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
  });

  it('rejects Secretary Permanent Delete when the current password is invalid', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
      passwordHash: 'hash',
    });
    passwordSecurity.verify.mockResolvedValue(false);

    await expect(
      service.permanentlyDelete(
        'secretary@example.com',
        'bad-password',
        true,
        'delete-key',
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('replays committed Secretary Permanent Delete without duplicating closure or authority-loss effects', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'secretary-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'secretary-1' }]);
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
      passwordHash: 'hash',
    });
    const fingerprint = createHash('sha256')
      .update(
        `${CommandType.SECRETARY_DELETE_ACCOUNT}|secretary-1|confirmed`,
        'utf8',
      )
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.permanentlyDelete(
        'secretary@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).resolves.toEqual({ permanentlyClosed: true, replayed: true });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.practiceStaff.updateMany).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
    expect(tx.applicationNotification.create).not.toHaveBeenCalled();
  });
});
