import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountLoginIdentifierType,
  AccountPermanentClosureType,
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { DoctorClosureFinancialSettlementService } from '../financial/doctor-closure-financial-settlement.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';

describe('DoctorLifecycleService', () => {
  let service: DoctorLifecycleService;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(),
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    userSession: { updateMany: jest.fn() },
    accountPermanentClosureAudit: { create: jest.fn() },
    notificationOutbox: { create: jest.fn() },
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const passwordSecurity = { verify: jest.fn().mockResolvedValue(true) };
  const protectedPayload = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };
  const closureFinancialSettlement = {
    prepare: jest.fn().mockResolvedValue({ doctorFinancialAccountId: null }),
    settle: jest.fn().mockResolvedValue({
      doctorFinancialAccountId: null,
      creditCreated: '0.00',
      creditedFuturePeriods: 0,
    }),
  };
  const mobileNumbers = {
    normalize: jest.fn((value: string) => ({ canonical: value })),
    hashCanonical: jest.fn((value: string) => `hash:${value}`),
    encrypt: jest.fn((value: string) => `mobile:${value}`),
  };
  const notificationPayload = {
    encryptMessage: jest.fn((value: string) => `notification:${value}`),
  };

  const currentEmailDoctor = (status = UserAccountStatus.ACTIVE) => ({
    id: 'doctor-1',
    email: 'doctor@example.com',
    mobileNumber: null,
    loginIdentifierType: AccountLoginIdentifierType.EMAIL,
    emailVerifiedAt: new Date('2026-09-01T00:00:00Z'),
    mobileVerifiedAt: null,
    role: UserRole.DOCTOR,
    accountStatus: status,
    passwordHash: 'hash',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordSecurityService, useValue: passwordSecurity },
        { provide: ProtectedAccountPayloadService, useValue: protectedPayload },
        {
          provide: DoctorClosureFinancialSettlementService,
          useValue: closureFinancialSettlement,
        },
        { provide: MobileNumberService, useValue: mobileNumbers },
        { provide: NotificationPayloadService, useValue: notificationPayload },
      ],
    }).compile();
    service = module.get(DoctorLifecycleService);
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockReset();
    passwordSecurity.verify.mockResolvedValue(true);
    protectedPayload.encrypt.mockImplementation(
      (value: string) => `enc:${value}`,
    );
    notificationPayload.encryptMessage.mockImplementation(
      (value: string) => `notification:${value}`,
    );
    closureFinancialSettlement.prepare.mockResolvedValue({
      doctorFinancialAccountId: null,
    });
    closureFinancialSettlement.settle.mockResolvedValue({
      doctorFinancialAccountId: null,
      creditCreated: '0.00',
      creditedFuturePeriods: 0,
    });
  });

  it('disables an active unrestricted Doctor, revokes sessions, and commits idempotency', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.user.findUnique
      .mockResolvedValueOnce({
        role: UserRole.DOCTOR,
        passwordHash: 'hash',
      })
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      });
    tx.$queryRaw.mockResolvedValue([{ id: 'doctor-1' }]);

    await expect(
      service.disable('doctor-1', 'disable-key', 'current-password'),
    ).resolves.toEqual({ disabled: true, replayed: false });
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
        createdAt: expect.any(Date) as unknown,
      }) as unknown,
    });
  });

  it('does not disable or replay a disable command with an incorrect password', async () => {
    tx.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      passwordHash: 'hash',
    });
    passwordSecurity.verify.mockResolvedValue(false);
    await expect(
      service.disable('doctor-1', 'disable-key', 'wrong'),
    ).rejects.toThrow('Current password');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(tx.commandIdempotency.findUnique).not.toHaveBeenCalled();
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
    tx.$queryRaw.mockResolvedValue([{ id: 'doctor-1' }]);

    await expect(
      service.reactivate(' Doctor@Example.com ', 'password', 'reactivate-key'),
    ).resolves.toEqual({ reactivated: true, replayed: false });
    expect(passwordSecurity.verify).toHaveBeenCalledWith('password', 'hash');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: { accountStatus: UserAccountStatus.ACTIVE },
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
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.SUSPENDED,
      passwordHash: 'hash',
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'doctor-1' }]);

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

  it('permanently closes an eligible Doctor, settles financial state, revokes sessions, audits exactly once, and creates one closure EMAIL intent', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'doctor-1' }])
      .mockResolvedValueOnce([]);
    tx.user.findUnique.mockResolvedValue(currentEmailDoctor());
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command-1' });
    closureFinancialSettlement.prepare.mockResolvedValue({
      doctorFinancialAccountId: 'financial-1',
    });

    await expect(
      service.permanentlyDelete(
        'doctor@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).resolves.toEqual({
      permanentlyClosed: true,
      replayed: false,
      publicRouteRetired: true,
    });

    expect(closureFinancialSettlement.prepare).toHaveBeenCalledWith(
      tx,
      'doctor-1',
    );
    expect(closureFinancialSettlement.settle).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        doctorFinancialAccountId: 'financial-1',
        recoveryIdentity: {
          type: 'EMAIL',
          value: 'doctor@example.com',
        },
        closureCommandId: 'command-1',
        closedAt: expect.any(Date) as unknown,
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-1' },
      data: { accountStatus: UserAccountStatus.PERMANENTLY_CLOSED },
    });
    expect(tx.userSession.updateMany).toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).toHaveBeenCalledWith({
      data: {
        accountUserId: 'doctor-1',
        initiatedByUserId: 'doctor-1',
        closureType: AccountPermanentClosureType.DOCTOR_PERMANENT_CLOSURE,
        previousAccountStatus: UserAccountStatus.ACTIVE,
        occurredAt: expect.any(Date) as unknown,
        commandIdempotencyId: 'command-1',
      },
    });
    expect(tx.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: NotificationType.SECURITY_NOTIFICATION,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        commandIdempotencyId: 'command-1',
      }) as unknown,
    });
  });

  it('rejects permanent closure when a Doctor-owned ClinicDay is STARTED without committing success effects', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'doctor-1' }])
      .mockResolvedValueOnce([{ id: 'clinic-day-1' }]);
    tx.user.findUnique.mockResolvedValue(currentEmailDoctor());
    tx.commandIdempotency.findUnique.mockResolvedValue(null);

    await expect(
      service.permanentlyDelete(
        'doctor@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
    expect(closureFinancialSettlement.settle).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects permanent closure while financial settlement reports an unresolved purchase or payment', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'doctor-1' }]);
    tx.user.findUnique.mockResolvedValue(currentEmailDoctor());
    tx.commandIdempotency.findUnique.mockResolvedValue(null);
    closureFinancialSettlement.prepare.mockRejectedValue(
      new ConflictException('Pending financial transaction.'),
    );

    await expect(
      service.permanentlyDelete(
        'doctor@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
    expect(closureFinancialSettlement.settle).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
  });

  it('replays a committed permanent closure without repeating durable effects', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'doctor-1' });
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'doctor-1' }]);
    tx.user.findUnique.mockResolvedValue(
      currentEmailDoctor(UserAccountStatus.PERMANENTLY_CLOSED),
    );
    const fingerprint = createHash('sha256')
      .update(`${CommandType.DOCTOR_DELETE_ACCOUNT}|doctor-1|confirmed`, 'utf8')
      .digest('hex');
    tx.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.permanentlyDelete(
        'doctor@example.com',
        'password',
        true,
        'delete-key',
      ),
    ).resolves.toEqual({
      permanentlyClosed: true,
      replayed: true,
      publicRouteRetired: true,
    });
    expect(closureFinancialSettlement.prepare).not.toHaveBeenCalled();
    expect(closureFinancialSettlement.settle).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.accountPermanentClosureAudit.create).not.toHaveBeenCalled();
    expect(tx.notificationOutbox.create).not.toHaveBeenCalled();
  });
});
