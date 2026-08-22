/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PublicBookingDuplicateUseExistingService } from './public-booking-duplicate-use-existing.service';

describe('PublicBookingDuplicateUseExistingService', () => {
  const serviceDate = new Date('2026-08-23T00:00:00.000Z');

  function createHarness(input: {
    individual?: {
      id: string;
      bookingReference: string;
      serviceDate: Date;
    } | null;
    groups?: Array<{ id: string; serviceDate: Date }>;
  }) {
    const draft = {
      id: 'draft-1',
      practiceLocationId: 'location-1',
      serviceDate,
      mobileNumberHash: 'mobile-hash',
      status: 'PENDING_OTP',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      consumedAt: null,
      cancelledAt: null,
      activeDraftKey: 'draft-key',
    };
    const otp = {
      id: 'otp-1',
      verifiedAt: new Date(),
      consumedAt: null,
      invalidatedAt: null,
      activeContextKey: 'BOOKING:draft-1',
    };
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([otp]),
      appointment: {
        findFirst: jest.fn().mockResolvedValue(input.individual ?? null),
      },
      bookingGroup: {
        findMany: jest.fn().mockResolvedValue(input.groups ?? []),
      },
      otpVerification: { update: jest.fn() },
      bookingDraft: { update: jest.fn() },
      bookingAccessToken: { updateMany: jest.fn() },
      bookingGroupAccessToken: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    const identity = {
      deriveAppointmentKey: jest.fn().mockReturnValue('active-key'),
      acquireAppointmentScopeLock: jest.fn(),
    };
    const individualTokens = {
      issueInitialToken: jest.fn().mockResolvedValue({
        rawToken: 'individual-token',
        tokenRecordId: 'token-1',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
      }),
    };
    const groupTokens = {
      issueInitialToken: jest.fn().mockResolvedValue({
        rawToken: 'group-token',
        tokenRecordId: 'token-2',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
      }),
    };
    const service = new PublicBookingDuplicateUseExistingService(
      prisma as never,
      identity as never,
      individualTokens,
      groupTokens,
    );
    return { service, transaction, individualTokens, groupTokens };
  }

  it('rotates individual access and terminalizes only the competing draft', async () => {
    const { service, transaction, individualTokens } = createHarness({
      individual: {
        id: 'appointment-1',
        bookingReference: 'BOOK-1',
        serviceDate,
      },
    });

    await expect(service.useExisting('draft-1')).resolves.toMatchObject({
      contextKind: 'INDIVIDUAL',
      bookingReference: 'BOOK-1',
    });
    expect(transaction.bookingAccessToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          appointmentId: 'appointment-1',
          revokedAt: null,
        }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(individualTokens.issueInitialToken).toHaveBeenCalledWith(
      transaction,
      'appointment-1',
      serviceDate,
    );
    expect(transaction.otpVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({
          consumedAt: expect.any(Date),
          activeContextKey: null,
        }),
      }),
    );
    expect(transaction.bookingDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          activeDraftKey: null,
          draftControlTokenHash: null,
        }),
      }),
    );
  });

  it('rotates group controller access without changing the existing group', async () => {
    const { service, transaction, groupTokens } = createHarness({
      groups: [{ id: 'group-1', serviceDate }],
    });

    await expect(service.useExisting('draft-1')).resolves.toMatchObject({
      contextKind: 'BOOKING_GROUP',
      bookingGroupId: 'group-1',
    });
    expect(transaction.bookingGroupAccessToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingGroupId: 'group-1',
          revokedAt: null,
        }),
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(groupTokens.issueInitialToken).toHaveBeenCalledWith(
      transaction,
      'group-1',
      serviceDate,
    );
    expect(transaction.bookingDraft.update).toHaveBeenCalledTimes(1);
  });
});
