import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  Prisma,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { SubscriptionCreditRecoveryService } from './subscription-credit-recovery.service';

type FinancialAccountFixture = {
  id: string;
  doctorUserId: string;
};

type RecoveryLedgerFixture = {
  id: string;
  doctorFinancialAccountId: string;
  counterpartyDoctorFinancialAccountId: string | null;
  relatedCreditEntryId: string | null;
  entryType: SubscriptionCreditEntryType;
  amount: Prisma.Decimal;
};

describe('SubscriptionCreditRecoveryService', () => {
  const recoveredAt = new Date('2026-08-20T17:00:00.000Z');

  function createFixture(available = '300.00') {
    const targetAccount: FinancialAccountFixture = {
      id: 'financial-new',
      doctorUserId: 'doctor-new',
    };
    const transaction = {
      $executeRaw: jest.fn(() => Promise.resolve(0)),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'doctor-new',
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
          })
          .mockResolvedValueOnce({
            accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
          }),
      },
      doctorFinancialAccount: {
        findUnique: jest.fn<Promise<FinancialAccountFixture | null>, []>(() =>
          Promise.resolve(targetAccount),
        ),
        create: jest.fn(() => Promise.resolve(targetAccount)),
      },
      commandIdempotency: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'command-1' })),
      },
      subscriptionCreditEntry: {
        findMany: jest.fn<Promise<RecoveryLedgerFixture[]>, []>(() =>
          Promise.resolve([]),
        ),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'transfer-out-1' })
          .mockResolvedValueOnce({ id: 'transfer-in-1' }),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const financialAccess = {
      authorize: jest.fn(() =>
        Promise.resolve({
          financialAccessSessionId: 'session-old',
          doctorFinancialAccountId: 'financial-old',
        }),
      ),
    };
    const idempotency = {
      normalizeKey: jest.fn((value: string | undefined) => value ?? 'key-1'),
      fingerprint: jest.fn((value: Record<string, unknown>) => {
        void value;
        return 'fingerprint-1';
      }),
      deriveIdentity: jest.fn(() => 'identity-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn<Promise<{ id: string } | null>, []>(() =>
        Promise.resolve(null),
      ),
      completionTimes: jest.fn(() => ({
        completedAt: recoveredAt,
        expiresAt: new Date(recoveredAt.getTime() + 60_000),
      })),
    };
    const accountLocks = {
      lockPair: jest.fn(() =>
        Promise.resolve([
          { id: 'financial-old', doctorUserId: 'doctor-old' },
          targetAccount,
        ]),
      ),
    };
    const creditBalance = {
      derive: jest.fn(() =>
        Promise.resolve({ available, reserved: '0.00', consumed: '0.00' }),
      ),
    };
    const service = new SubscriptionCreditRecoveryService(
      prisma as never,
      financialAccess as never,
      idempotency as never,
      accountLocks as never,
      creditBalance as never,
    );
    return {
      service,
      transaction,
      financialAccess,
      idempotency,
      accountLocks,
      creditBalance,
    };
  }

  const input = {
    authenticatedUserId: 'doctor-new',
    historicalDoctorFinancialAccountId: 'financial-old',
    financialAccessToken: 'financial-token-old',
    idempotencyKey: 'recover-1',
    recoveredAt,
  };

  it('transfers all eligible available historical credit atomically to the current Doctor account', async () => {
    const fixture = createFixture('300.00');

    await expect(fixture.service.recover(input)).resolves.toEqual({
      sourceDoctorFinancialAccountId: 'financial-old',
      targetDoctorFinancialAccountId: 'financial-new',
      recoveredAmount: '300.00',
      replayed: false,
    });

    expect(fixture.financialAccess.authorize).toHaveBeenCalledWith(
      'financial-token-old',
      'financial-old',
    );
    expect(fixture.accountLocks.lockPair).toHaveBeenCalledWith(
      fixture.transaction,
      'financial-old',
      'financial-new',
    );
    expect(fixture.transaction.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.DOCTOR_RECOVER_SUBSCRIPTION_CREDIT,
        actorUserId: 'doctor-new',
        accountUserId: 'doctor-new',
        doctorFinancialAccountId: 'financial-old',
      }) as object,
      select: { id: true },
    });
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        doctorFinancialAccountId: 'financial-old',
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
        amount: new Prisma.Decimal('300.00'),
        counterpartyDoctorFinancialAccountId: 'financial-new',
      }) as object,
      select: { id: true },
    });
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        doctorFinancialAccountId: 'financial-new',
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
        amount: new Prisma.Decimal('300.00'),
        counterpartyDoctorFinancialAccountId: 'financial-old',
        relatedCreditEntryId: 'transfer-out-1',
      }) as object,
    });
  });

  it('creates the target DoctorFinancialAccount inside the protected transaction when absent', async () => {
    const fixture = createFixture('100.00');
    fixture.transaction.doctorFinancialAccount.findUnique.mockResolvedValueOnce(
      null,
    );

    await fixture.service.recover(input);

    expect(
      fixture.transaction.doctorFinancialAccount.create,
    ).toHaveBeenCalledWith({
      data: { doctorUserId: 'doctor-new' },
      select: { id: true, doctorUserId: true },
    });
  });

  it('rejects recovery when the current actor is not an eligible Doctor', async () => {
    const fixture = createFixture();
    fixture.transaction.user.findUnique.mockReset().mockResolvedValueOnce({
      id: 'doctor-new',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.VOLUNTARILY_DISABLED,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });

    await expect(fixture.service.recover(input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects recovery when no eligible available historical credit remains', async () => {
    const fixture = createFixture('0.00');

    await expect(fixture.service.recover(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('reconstructs a compatible replay without appending a second transfer pair', async () => {
    const fixture = createFixture();
    fixture.idempotency.findReplay.mockResolvedValueOnce({ id: 'command-1' });
    fixture.transaction.subscriptionCreditEntry.findMany.mockResolvedValueOnce([
      {
        id: 'out-1',
        doctorFinancialAccountId: 'financial-old',
        counterpartyDoctorFinancialAccountId: 'financial-new',
        relatedCreditEntryId: null,
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
        amount: new Prisma.Decimal('300.00'),
      },
      {
        id: 'in-1',
        doctorFinancialAccountId: 'financial-new',
        counterpartyDoctorFinancialAccountId: 'financial-old',
        relatedCreditEntryId: 'out-1',
        entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
        amount: new Prisma.Decimal('300.00'),
      },
    ]);

    await expect(fixture.service.recover(input)).resolves.toEqual({
      sourceDoctorFinancialAccountId: 'financial-old',
      targetDoctorFinancialAccountId: 'financial-new',
      recoveredAmount: '300.00',
      replayed: true,
    });
    expect(fixture.accountLocks.lockPair).not.toHaveBeenCalled();
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('never includes the raw FinancialAccessSession token in the command fingerprint', async () => {
    const fixture = createFixture();

    await fixture.service.recover(input);

    const fingerprintInput = fixture.idempotency.fingerprint.mock.calls[0]?.[0];
    expect(JSON.stringify(fingerprintInput)).not.toContain(
      'financial-token-old',
    );
  });
});
