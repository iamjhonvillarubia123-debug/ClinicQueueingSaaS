import {
  BookingGroupRecoveryAttemptStatus,
  CommandType,
} from '../../generated/prisma/client';
import { BookingGroupRecoveryService } from './booking-group-recovery.service';

describe('BookingGroupRecoveryService', () => {
  const protectedMobile = {
    encrypted: 'encrypted-mobile',
    hash: 'mobile-hash',
    lastFour: '1234',
  };

  function buildService(transaction: Record<string, unknown>) {
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    const mobile = { protect: jest.fn().mockReturnValue(protectedMobile) };
    const otpGenerator = { generate: jest.fn().mockReturnValue('123456') };
    const otpService = {
      hashOtp: jest.fn().mockReturnValue('otp-hash'),
      verifyOtpHash: jest.fn().mockReturnValue(true),
    };
    const idempotency = {
      normalizeKey: jest.fn((value: string) => value),
      deriveIdentity: jest.fn().mockReturnValue('command-identity'),
      fingerprint: jest.fn().mockReturnValue('request-fingerprint'),
      acquireCommandLock: jest.fn().mockResolvedValue(undefined),
      findReplay: jest.fn().mockResolvedValue(null),
      completionTimes: jest.fn().mockReturnValue({
        completedAt: new Date('2026-08-18T05:00:00.000Z'),
        expiresAt: new Date('2026-08-25T05:00:00.000Z'),
      }),
    };

    return {
      service: new BookingGroupRecoveryService(
        prisma as never,
        mobile as never,
        otpGenerator as never,
        otpService as never,
        idempotency as never,
      ),
      idempotency,
      mobile,
    };
  }

  it('returns the same generic recovery shape when no BookingGroup candidate exists', async () => {
    const transaction = {
      bookingGroup: { findMany: jest.fn().mockResolvedValue([]) },
      bookingGroupRecoveryAttempt: {
        create: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          expiresAt: new Date('2026-08-18T06:00:00.000Z'),
        }),
      },
      otpVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };
    const { service } = buildService(transaction);

    const result = await service.request({
      practiceLocationId: '11111111-1111-4111-8111-111111111111',
      serviceDate: '2026-08-20',
      mobileNumber: '09171234567',
    });

    expect(result.message).toBe(
      'If the booking group can be recovered, verification will continue.',
    );
    expect(result.recoveryAttemptId).toBe('attempt-1');
    expect(transaction.bookingGroupRecoveryAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bookingGroupId: null }),
      }),
    );
  });

  it('returns the committed logical result on compatible replay without rotating again', async () => {
    const transaction = {};
    const { service, idempotency } = buildService(transaction);
    idempotency.findReplay.mockResolvedValue({
      resultBookingGroupId: 'group-1',
      resultBookingGroupAccessTokenId: 'token-record-1',
    });

    const result = await service.complete('attempt-1', 'idem-1');

    expect(result).toEqual({
      replayed: true,
      bookingGroupId: 'group-1',
      replacementTokenRecordId: 'token-record-1',
      rawToken: null,
    });
    expect(idempotency.deriveIdentity).toHaveBeenCalledWith({
      idempotencyKey: 'idem-1',
      commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
      scope: { bookingGroupRecoveryAttemptId: 'attempt-1' },
    });
  });

  it('atomically revokes active group tokens, creates one replacement, consumes OTP and records completion', async () => {
    const nowFuture = new Date(Date.now() + 60 * 60 * 1000);
    const serviceDate = new Date('2026-08-20T00:00:00.000Z');
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const createToken = jest.fn().mockResolvedValue({
      id: 'replacement-token-record',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'attempt-1',
            practiceLocationId: 'location-1',
            serviceDate,
            mobileNumberHash: 'mobile-hash',
            bookingGroupId: 'group-1',
            status: BookingGroupRecoveryAttemptStatus.VERIFIED,
            expiresAt: nowFuture,
            completedAt: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'group-1',
            practiceLocationId: 'location-1',
            serviceDate,
            controllingMobileNumberHash: 'mobile-hash',
          },
        ]),
      appointment: { count: jest.fn().mockResolvedValue(2) },
      otpVerification: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          expiresAt: nowFuture,
        }),
        update: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
      bookingGroupAccessToken: {
        updateMany,
        create: createToken,
      },
      bookingGroupRecoveryAttempt: {
        update: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
      commandIdempotency: {
        create: jest.fn().mockResolvedValue({ id: 'command-1' }),
      },
    };
    const { service } = buildService(transaction);

    const result = await service.complete('attempt-1', 'idem-1');

    expect(result.replayed).toBe(false);
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(transaction.otpVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
    expect(transaction.commandIdempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
          resultBookingGroupId: 'group-1',
          resultBookingGroupAccessTokenId: 'replacement-token-record',
        }),
      }),
    );
  });
});
