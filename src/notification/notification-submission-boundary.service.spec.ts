import { BadRequestException } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';

type MockTransaction = {
  $queryRaw: jest.Mock<Promise<unknown[]>, unknown[]>;
  notificationLog: {
    findFirst: jest.Mock<
      Promise<{ attemptNumber: number } | null>,
      [Record<string, unknown>]
    >;
  };
  notificationOutbox: {
    update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
  };
};

type OtpRow = {
  id: string;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

describe('NotificationSubmissionBoundaryService', () => {
  const now = new Date('2026-08-19T05:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-19T05:05:00.000Z');
  const freshOtp: OtpRow = {
    id: 'otp-1',
    expiresAt: new Date('2026-08-19T05:10:00.000Z'),
    consumedAt: null,
    invalidatedAt: null,
  };

  function createService(
    attemptCount: number,
    latestRecordedAttempt: number,
    options: {
      notificationType?: NotificationType;
      otpVerificationId?: string | null;
      otp?: OtpRow | null;
    } = {},
  ) {
    let rawQueryCount = 0;
    const notificationType =
      options.notificationType ?? NotificationType.BOOKING_CONFIRMATION;
    const otpVerificationId = options.otpVerificationId ?? null;
    const otp = options.otp === undefined ? freshOtp : options.otp;

    const transaction: MockTransaction = {
      $queryRaw: jest.fn(() => {
        rawQueryCount += 1;
        if (rawQueryCount === 1) {
          return Promise.resolve([
            {
              id: 'outbox-1',
              notificationType,
              status: NotificationOutboxStatus.PROCESSING,
              otpVerificationId,
              attemptCount,
              processingWorkerId: 'worker-1',
              leaseExpiresAt,
            },
          ]);
        }
        return Promise.resolve(otp ? [otp] : []);
      }),
      notificationLog: {
        findFirst: jest.fn((args: Record<string, unknown>) => {
          void args;
          return Promise.resolve(
            latestRecordedAttempt > 0
              ? { attemptNumber: latestRecordedAttempt }
              : null,
          );
        }),
      },
      notificationOutbox: {
        update: jest.fn((args: Record<string, unknown>) => {
          void args;
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: MockTransaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationSubmissionBoundaryService(prisma as never),
      transaction,
    };
  }

  it('allocates the next attempt number before provider submission', async () => {
    const { service, transaction } = createService(2, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 3 });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { attemptCount: 3 },
    });
  });

  it('reuses one outstanding reserved attempt after safe reconciliation', async () => {
    const { service, transaction } = createService(3, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 3 });

    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it('cancels an expired OTP before reserving provider submission', async () => {
    const { service, transaction } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: { ...freshOtp, expiresAt: now },
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: now,
        processingStartedAt: null,
        leaseExpiresAt: null,
        processingWorkerId: null,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: null,
        protectedPayloadPurgedAt: now,
      },
    });
  });

  it('cancels an invalidated OTP before provider submission', async () => {
    const { service } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: { ...freshOtp, invalidatedAt: new Date(now.getTime() - 1_000) },
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });
  });

  it('cancels a consumed OTP before provider submission', async () => {
    const { service } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: { ...freshOtp, consumedAt: new Date(now.getTime() - 1_000) },
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });
  });

  it('reserves a still-usable OTP because verification alone does not consume it', async () => {
    const { service, transaction } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: freshOtp,
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 1 });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { attemptCount: 1 },
    });
  });

  it('does not cancel a stale OTP when a provider attempt is already outstanding', async () => {
    const { service, transaction } = createService(1, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: { ...freshOtp, expiresAt: now },
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 1 });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
  });

  it('rejects an OTP notification without its verification context', async () => {
    const { service } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: null,
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an OTP notification whose verification context is missing', async () => {
    const { service } = createService(0, 0, {
      notificationType: NotificationType.OTP_VERIFICATION,
      otpVerificationId: 'otp-1',
      otp: null,
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inconsistent attempt-history gap', async () => {
    const { service } = createService(4, 2);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reservation without an active worker lease', async () => {
    const { service, transaction } = createService(0, 0);
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'outbox-1',
        notificationType: NotificationType.BOOKING_CONFIRMATION,
        status: NotificationOutboxStatus.PROCESSING,
        otpVerificationId: null,
        attemptCount: 0,
        processingWorkerId: 'other-worker',
        leaseExpiresAt,
      },
    ]);

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
