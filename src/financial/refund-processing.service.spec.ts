import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationType,
  Prisma,
  RefundRequestStatus,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { RefundProcessingService } from './refund-processing.service';

describe('RefundProcessingService', () => {
  const occurredAt = new Date('2026-08-20T16:00:00.000Z');

  function createFixture() {
    const refund = {
      id: 'refund-1',
      doctorFinancialAccountId: 'financial-1',
      requestedAmount: new Prisma.Decimal('250.00'),
      status: RefundRequestStatus.PENDING,
    };
    const reservation = {
      id: 'reservation-1',
      amount: new Prisma.Decimal('250.00'),
    };
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([refund])),
      commandIdempotency: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'command-1' })),
      },
      refundRequest: {
        findUnique: jest.fn(() => Promise.resolve(refund)),
        update: jest.fn(({ data }: { data: { status: RefundRequestStatus } }) =>
          Promise.resolve({ ...refund, ...data }),
        ),
      },
      refundProcessingAttempt: {
        create: jest.fn(() => Promise.resolve({ id: 'attempt-1' })),
      },
      subscriptionCreditEntry: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(reservation)
          .mockResolvedValueOnce(null),
        create: jest.fn(() => Promise.resolve({ id: 'release-1' })),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'admin-1',
            role: UserRole.SYSTEM_ADMIN,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
          })
          .mockResolvedValueOnce({ email: 'doctor@example.com' }),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const idempotency = {
      normalizeKey: jest.fn((value: string | undefined) => value ?? 'key-1'),
      fingerprint: jest.fn(() => 'fingerprint-1'),
      deriveIdentity: jest.fn(() => 'identity-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn(() => Promise.resolve(null)),
      completionTimes: jest.fn(() => ({
        completedAt: occurredAt,
        expiresAt: new Date(occurredAt.getTime() + 60_000),
      })),
    };
    const accountLocks = {
      lockById: jest.fn(() =>
        Promise.resolve({ id: 'financial-1', doctorUserId: 'doctor-1' }),
      ),
    };
    const refundNotifications = {
      create: jest.fn(() => Promise.resolve()),
    };
    const service = new RefundProcessingService(
      prisma as never,
      idempotency as never,
      accountLocks as never,
      refundNotifications as never,
    );
    return {
      service,
      transaction,
      idempotency,
      accountLocks,
      refundNotifications,
    };
  }

  it('completes only a confirmed transferred refund and records immutable attempt evidence', async () => {
    const fixture = createFixture();

    const result = await fixture.service.complete({
      authenticatedSystemAdminUserId: 'admin-1',
      refundRequestId: 'refund-1',
      idempotencyKey: 'complete-1',
      provider: 'GCASH',
      attemptReference: 'attempt-ref-1',
      completionReference: 'complete-ref-1',
      proofReference: 'proof-ref-1',
      transferConfirmed: true,
      completedAt: occurredAt,
    });

    expect(result.refundRequest.status).toBe(RefundRequestStatus.COMPLETED);
    expect(fixture.transaction.refundProcessingAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: 'TRANSFER_COMPLETED',
        processedBySystemAdminUserId: 'admin-1',
      }) as object,
    });
    expect(fixture.transaction.subscriptionCreditEntry.create).not.toHaveBeenCalled();
    expect(fixture.refundNotifications.create).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        notificationType: NotificationType.REFUND_COMPLETED,
      }),
    );
  });

  it('fails a confirmed non-recoverable refund and releases exactly that reservation', async () => {
    const fixture = createFixture();

    const result = await fixture.service.fail({
      authenticatedSystemAdminUserId: 'admin-1',
      refundRequestId: 'refund-1',
      idempotencyKey: 'fail-1',
      provider: 'GCASH',
      attemptReference: 'attempt-ref-2',
      failureCategory: 'DESTINATION_REJECTED',
      failureDetailSanitized: 'Provider rejected destination.',
      confirmedNonRecoverable: true,
      failedAt: occurredAt,
    });

    expect(result.refundRequest.status).toBe(RefundRequestStatus.FAILED);
    expect(fixture.transaction.subscriptionCreditEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: SubscriptionCreditEntryType.REFUND_FAILED_RELEASED,
        relatedCreditEntryId: 'reservation-1',
        refundRequestId: 'refund-1',
      }) as object,
    });
    expect(fixture.refundNotifications.create).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        notificationType: NotificationType.REFUND_FAILED,
      }),
    );
  });

  it('does not allow an unconfirmed transient failure to become terminal FAILED', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.fail({
        authenticatedSystemAdminUserId: 'admin-1',
        refundRequestId: 'refund-1',
        idempotencyKey: 'fail-1',
        provider: 'GCASH',
        attemptReference: 'attempt-ref-2',
        failureCategory: 'TEMPORARY_PROVIDER_ERROR',
        confirmedNonRecoverable: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.transaction.refundRequest.update).not.toHaveBeenCalled();
  });

  it('requires current SYSTEM_ADMIN authority for terminal processing', async () => {
    const fixture = createFixture();
    fixture.transaction.user.findUnique.mockReset().mockResolvedValueOnce({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });

    await expect(
      fixture.service.complete({
        authenticatedSystemAdminUserId: 'doctor-1',
        refundRequestId: 'refund-1',
        idempotencyKey: 'complete-1',
        provider: 'GCASH',
        attemptReference: 'attempt-ref-1',
        completionReference: 'complete-ref-1',
        proofReference: 'proof-ref-1',
        transferConfirmed: true,
        completedAt: occurredAt,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores the exact refund financial scope on the admin idempotency command', async () => {
    const fixture = createFixture();

    await fixture.service.complete({
      authenticatedSystemAdminUserId: 'admin-1',
      refundRequestId: 'refund-1',
      idempotencyKey: 'complete-1',
      provider: 'GCASH',
      attemptReference: 'attempt-ref-1',
      completionReference: 'complete-ref-1',
      proofReference: 'proof-ref-1',
      transferConfirmed: true,
      completedAt: occurredAt,
    });

    expect(fixture.transaction.commandIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandType: CommandType.SYSTEM_ADMIN_COMPLETE_REFUND,
        actorUserId: 'admin-1',
        accountUserId: null,
        doctorFinancialAccountId: 'financial-1',
      }) as object,
      select: { id: true },
    });
  });
});
