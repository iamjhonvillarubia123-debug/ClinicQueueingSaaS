import {
  BookingGroupRecoveryAttemptStatus,
  CommandType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { BookingGroupRecoveryService } from './booking-group-recovery.service';

type ReplayRecord = Awaited<
  ReturnType<CommandIdempotencyService['findReplay']>
>;

type CreateAttemptArgs = {
  data: { bookingGroupId: string | null };
};

type UpdateOtpArgs = {
  where: { id: string };
  data: { consumedAt: Date };
};

type CreateCommandArgs = {
  data: {
    commandType: CommandType;
    resultBookingGroupId: string;
    resultBookingGroupAccessTokenId: string;
  };
};

class TestCommandIdempotencyService extends CommandIdempotencyService {
  readonly normalizeKeyMock = jest.fn(
    (value: string | undefined): string => value ?? '',
  );
  readonly deriveIdentityMock = jest.fn().mockReturnValue('command-identity');
  readonly fingerprintMock = jest.fn().mockReturnValue('request-fingerprint');
  readonly acquireCommandLockMock = jest.fn().mockResolvedValue(undefined);
  readonly findReplayMock = jest
    .fn<
      Promise<ReplayRecord>,
      Parameters<CommandIdempotencyService['findReplay']>
    >()
    .mockResolvedValue(null);
  readonly completionTimesMock = jest.fn().mockReturnValue({
    completedAt: new Date('2026-08-18T05:00:00.000Z'),
    expiresAt: new Date('2026-08-25T05:00:00.000Z'),
  });

  override normalizeKey(value: string | undefined): string {
    return this.normalizeKeyMock(value);
  }

  override deriveIdentity(
    input: Parameters<CommandIdempotencyService['deriveIdentity']>[0],
  ): string {
    return this.deriveIdentityMock(input);
  }

  override fingerprint(
    input: Parameters<CommandIdempotencyService['fingerprint']>[0],
  ): string {
    return this.fingerprintMock(input);
  }

  override acquireCommandLock(
    transaction: Parameters<CommandIdempotencyService['acquireCommandLock']>[0],
    commandIdentityKey: string,
  ): Promise<void> {
    return this.acquireCommandLockMock(transaction, commandIdentityKey);
  }

  override findReplay(
    transaction: Parameters<CommandIdempotencyService['findReplay']>[0],
    commandIdentityKey: string,
    requestFingerprint: string,
  ): ReturnType<CommandIdempotencyService['findReplay']> {
    return this.findReplayMock(
      transaction,
      commandIdentityKey,
      requestFingerprint,
    );
  }

  override completionTimes(now?: Date) {
    return this.completionTimesMock(now);
  }
}

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
    const idempotency = new TestCommandIdempotencyService();

    return {
      service: new BookingGroupRecoveryService(
        prisma as never,
        mobile as never,
        otpGenerator as never,
        otpService as never,
        idempotency,
      ),
      idempotency,
      mobile,
    };
  }

  it('returns the same generic recovery shape when no BookingGroup candidate exists', async () => {
    const createAttempt = jest
      .fn<
        Promise<{
          id: string;
          expiresAt: Date;
        }>,
        [CreateAttemptArgs]
      >()
      .mockResolvedValue({
        id: 'attempt-1',
        expiresAt: new Date('2026-08-18T06:00:00.000Z'),
      });
    const transaction = {
      bookingGroup: { findMany: jest.fn().mockResolvedValue([]) },
      bookingGroupRecoveryAttempt: {
        create: createAttempt,
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
    expect(createAttempt).toHaveBeenCalledTimes(1);
    const [createAttemptArgs] = createAttempt.mock.calls[0] ?? [];
    expect(createAttemptArgs?.data.bookingGroupId).toBeNull();
  });

  it('returns the committed logical result on compatible replay without rotating again', async () => {
    const transaction = {};
    const { service, idempotency } = buildService(transaction);
    const replay = {
      id: 'command-1',
      commandIdentityKey: 'command-identity',
      idempotencyKey: 'idem-1',
      commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
      requestFingerprint: 'request-fingerprint',
      practiceLocationId: null,
      serviceDate: null,
      clinicDayId: null,
      appointmentId: null,
      bookingGroupId: 'group-1',
      bookingDraftId: null,
      bookingGroupRecoveryAttemptId: 'attempt-1',
      resultAppointmentId: null,
      resultBookingGroupId: 'group-1',
      resultBookingAccessTokenId: null,
      resultBookingGroupAccessTokenId: 'token-record-1',
      resultQueueNumber: null,
      resultClinicDayStatus: null,
      completedAt: new Date('2026-08-18T05:00:00.000Z'),
      expiresAt: new Date('2026-08-25T05:00:00.000Z'),
      createdAt: new Date('2026-08-18T05:00:00.000Z'),
    } satisfies Exclude<ReplayRecord, null>;
    idempotency.findReplayMock.mockResolvedValue(replay);

    const result = await service.complete('attempt-1', 'idem-1');

    expect(result).toEqual({
      replayed: true,
      bookingGroupId: 'group-1',
      replacementTokenRecordId: 'token-record-1',
      rawToken: null,
    });
    expect(idempotency.deriveIdentityMock).toHaveBeenCalledWith({
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
    const updateOtp = jest
      .fn<Promise<{ id: string }>, [UpdateOtpArgs]>()
      .mockResolvedValue({ id: 'otp-1' });
    const createCommand = jest
      .fn<Promise<{ id: string }>, [CreateCommandArgs]>()
      .mockResolvedValue({ id: 'command-1' });
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
        update: updateOtp,
      },
      bookingGroupAccessToken: {
        updateMany,
        create: createToken,
      },
      bookingGroupRecoveryAttempt: {
        update: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
      commandIdempotency: {
        create: createCommand,
      },
    };
    const { service } = buildService(transaction);

    const result = await service.complete('attempt-1', 'idem-1');

    expect(result.replayed).toBe(false);
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(updateOtp).toHaveBeenCalledTimes(1);
    const [updateOtpArgs] = updateOtp.mock.calls[0] ?? [];
    expect(updateOtpArgs?.where).toEqual({ id: 'otp-1' });
    expect(updateOtpArgs?.data.consumedAt).toBeInstanceOf(Date);

    expect(createCommand).toHaveBeenCalledTimes(1);
    const [createCommandArgs] = createCommand.mock.calls[0] ?? [];
    expect(createCommandArgs?.data.commandType).toBe(
      CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
    );
    expect(createCommandArgs?.data.resultBookingGroupId).toBe('group-1');
    expect(createCommandArgs?.data.resultBookingGroupAccessTokenId).toBe(
      'replacement-token-record',
    );
  });
});
