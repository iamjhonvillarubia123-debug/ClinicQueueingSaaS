import { BadRequestException } from '@nestjs/common';
import {
  CommandType,
  Prisma,
  RefundMethod,
  RefundRequestStatus,
  SubscriptionCreditEntryType,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { RefundRequestService } from './refund-request.service';

describe('RefundRequestService', () => {
  function createFixture(available = '500.00') {
    const refundRequest = {
      id: 'refund-1',
      doctorFinancialAccountId: 'financial-1',
      requestedAmount: new Prisma.Decimal('250.00'),
      status: RefundRequestStatus.PENDING,
      commandIdempotencyId: 'command-1',
    };
    const transaction = {
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({ accountStatus: UserAccountStatus.PERMANENTLY_CLOSED }),
        ),
      },
      commandIdempotency: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'command-1' })),
      },
      refundRequest: {
        findUnique: jest.fn(() => Promise.resolve(refundRequest)),
        create: jest.fn(() => Promise.resolve(refundRequest)),
      },
      subscriptionCreditEntry: {
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(() => Promise.resolve({ id: 'reservation-1' })),
      },
      $executeRaw: jest.fn(() => Promise.resolve(0)),
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const financialAccess = {
      authorize: jest.fn(() =>
        Promise.resolve({
          financialAccessSessionId: 'session-1',
          doctorFinancialAccountId: 'financial-1',
        }),
      ),
    };
    const idempotency = {
      normalizeKey: jest.fn((value: string | undefined) => value ?? 'key-1'),
      fingerprint: jest.fn(() => 'fingerprint-1'),
      deriveIdentity: jest.fn(() => 'identity-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn(() => Promise.resolve(null)),
      completionTimes: jest.fn(() => ({
        completedAt: new Date('2026-08-20T10:00:00.000Z'),
        expiresAt: new Date('2026-08-27T10:00:00.000Z'),
      })),
    };
    const accountLocks = {
      lockById: jest.fn(() =>
        Promise.resolve({ id: 'financial-1', doctorUserId: 'doctor-1' }),
      ),
    };
    const creditBalance = {
      derive: jest.fn(() =>
        Promise.resolve({ available, reserved: '0.00', consumed: '0.00' }),
      ),
    };
    const protectedPayload = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    };
    const service = new RefundRequestService(
      prisma as never,
      financialAccess as never,
      idempotency as never,
      accountLocks as never,
      creditBalance as never,
      protectedPayload as never,
    );
    return {
      service,
      transaction,
      financialAccess,
      idempotency,
      accountLocks,
      creditBalance,
      protectedPayload,
      refundRequest,
    };
  }

  const input = {
    financialAccessToken: 'financial-token',
    idempotencyKey: 'refund-key-1',
    requestedAmount: '250.00',
    reasonCode: 'ACCOUNT_CLOSED',
    otherReasonText: null,
    method: RefundMethod.GCASH,
    accountName: 'Doctor Example',
    destination: '09171234567',
    destinationConfirmation: '09171234567',
    acknowledged: true,
  };

  it('creates one pending refund and reserves the requested credit atomically', async () => {
    const fixture = createFixture();

    await expect(fixture.service.create(input)).resolves.toMatchObject({
      replayed: false,
      refundRequest: { id: 'refund-1' },
    });

    expect(fixture.financialAccess.authorize).toHaveBeenCalledWith(
      'financial-token',
    );
    expect(fixture.accountLocks.lockById).toHaveBeenCalledWith(
      fixture.transaction,
      'financial-1',
    );
    expect(fixture.transaction.commandIdempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandType: CommandType.DOCTOR_REQUEST_REFUND,
          actorUserId: null,
          accountUserId: null,
          doctorFinancialAccountId: 'financial-1',
        }) as object,
      }),
    );
    expect(fixture.transaction.refundRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RefundRequestStatus.PENDING,
          destinationLast4: '4567',
        }) as object,
      }),
    );
    expect(fixture.transaction.subscriptionCreditEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: SubscriptionCreditEntryType.REFUND_RESERVED,
          refundRequestId: 'refund-1',
        }) as object,
      }),
    );
  });

  it('rejects a refund above available refundable credit', async () => {
    const fixture = createFixture('100.00');

    await expect(fixture.service.create(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fixture.transaction.refundRequest.create).not.toHaveBeenCalled();
    expect(
      fixture.transaction.subscriptionCreditEntry.create,
    ).not.toHaveBeenCalled();
  });

  it('requires matching destination confirmation and final acknowledgement', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        ...input,
        destinationConfirmation: '09170000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      fixture.service.create({ ...input, acknowledged: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.transaction.refundRequest.create).not.toHaveBeenCalled();
  });

  it('does not place the raw financial token or raw destination in the fingerprint input', async () => {
    const fixture = createFixture();

    await fixture.service.create(input);

    expect(fixture.idempotency.fingerprint).toHaveBeenCalledTimes(1);
    const fingerprintInput = fixture.idempotency.fingerprint.mock.calls[0]?.[0];
    expect(JSON.stringify(fingerprintInput)).not.toContain('financial-token');
    expect(JSON.stringify(fingerprintInput)).not.toContain('09171234567');
  });
});
