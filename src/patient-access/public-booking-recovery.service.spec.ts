import { PublicBookingRecoveryService } from './public-booking-recovery.service';

describe('PublicBookingRecoveryService replacement authority binding', () => {
  it('uses one timestamp for replacement booking OTP creation and verification', async () => {
    const serviceDate = new Date('2026-08-24T00:00:00.000Z');
    const authorityExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const draftExpiresAt = new Date(Date.now() + 20 * 60 * 1000);

    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'draft-1',
          practiceLocationId: 'location-1',
          serviceDate,
          mobileNumberHash: 'mobile-hash-1',
          status: 'PENDING_OTP',
          expiresAt: draftExpiresAt,
        },
      ]),
      otpVerification: {
        create: jest.fn().mockResolvedValue({ id: 'booking-otp-1' }),
        update: jest.fn().mockResolvedValue({ id: 'recovery-otp-1' }),
      },
      bookingRecoveryAttempt: {
        update: jest.fn(),
      },
      bookingGroupRecoveryAttempt: {
        update: jest.fn().mockResolvedValue({ id: 'recovery-1' }),
      },
      bookingDraft: {
        update: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
      ),
      bookingRecoveryAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      bookingGroupRecoveryAttempt: {
        findUnique: jest.fn().mockResolvedValue({ id: 'recovery-1' }),
      },
    };

    const service = new PublicBookingRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    jest
      .spyOn(service as never, 'lockVerifiedReplacementScope' as never)
      .mockResolvedValue({
        kind: 'BOOKING_GROUP',
        recoveryAttemptId: 'recovery-1',
        practiceLocationId: 'location-1',
        serviceDate,
        mobileNumberHash: 'mobile-hash-1',
        expiresAt: authorityExpiresAt,
      } as never);
    jest
      .spyOn(service as never, 'lockVerifiedRecoveryOtp' as never)
      .mockResolvedValue({
        id: 'recovery-otp-1',
        verifiedAt: new Date(),
        consumedAt: null,
        invalidatedAt: null,
        activeContextKey: 'RECOVERY_REPLACEMENT:recovery-1',
        expiresAt: authorityExpiresAt,
      } as never);

    await service.bindReplacementAuthorityToDraft({
      recoveryAttemptId: 'recovery-1',
      bookingDraftId: 'draft-1',
      mobileNumberHash: 'mobile-hash-1',
      practiceLocationId: 'location-1',
      serviceDate,
    });

    expect(transaction.otpVerification.create).toHaveBeenCalledTimes(1);
    const createCall = transaction.otpVerification.create.mock
      .calls[0]?.[0] as {
      data: { createdAt: Date; verifiedAt: Date; expiresAt: Date };
    };
    expect(createCall.data.createdAt).toBeInstanceOf(Date);
    expect(createCall.data.verifiedAt).toBeInstanceOf(Date);
    expect(createCall.data.createdAt.getTime()).toBe(
      createCall.data.verifiedAt.getTime(),
    );
    expect(createCall.data.expiresAt.getTime()).toBe(
      authorityExpiresAt.getTime(),
    );
  });
});
