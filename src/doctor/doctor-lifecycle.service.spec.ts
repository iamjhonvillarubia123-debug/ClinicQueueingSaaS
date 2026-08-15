import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';

describe('DoctorLifecycleService', () => {
  let service: DoctorLifecycleService;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'doctor-1' }]),
    commandIdempotency: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userSession: {
      updateMany: jest.fn(),
    },
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
        DoctorLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordSecurityService, useValue: passwordSecurity },
      ],
    }).compile();
    service = module.get(DoctorLifecycleService);
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValue([{ id: 'doctor-1' }]);
    passwordSecurity.verify.mockResolvedValue(true);
  });

  it('disables an active unrestricted Doctor, revokes sessions, and commits idempotency', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });

    await expect(service.disable('doctor-1', 'disable-key')).resolves.toEqual({
      disabled: true,
      replayed: false,
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: { accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalled();
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.DOCTOR_DISABLE_ACCOUNT,
        actorUserId: 'doctor-1',
        accountUserId: 'doctor-1',
      }) as unknown,
    });
  });

  it('reactivates only a voluntarily disabled unrestricted Doctor and creates no session', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      passwordHash: 'hash',
    });

    await expect(
      service.reactivate(' Doctor@Example.com ', 'password', 'reactivate-key'),
    ).resolves.toEqual({ reactivated: true, replayed: false });
    expect(passwordSecurity.verify).toHaveBeenCalledWith('password', 'hash');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: { accountStatus: UserAccountStatus.ACTIVE },
    });
    expect(tx.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.DOCTOR_REACTIVATE_ACCOUNT,
        actorUserId: null,
        accountUserId: 'doctor-1',
      }) as unknown,
    });
    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not let Reactivation bypass an administrative restriction', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      administrativeRestrictionStatus:
        AdministrativeRestrictionStatus.SUSPENDED,
      passwordHash: 'hash',
    });

    await expect(
      service.reactivate('doctor@example.com', 'password', 'key'),
    ).rejects.toThrow(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('uses a generic credential failure for a missing current Doctor account', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.reactivate('missing@example.com', 'password', 'key'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
