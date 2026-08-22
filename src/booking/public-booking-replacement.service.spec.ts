import { ConflictException } from '@nestjs/common';
import { PublicBookingReplacementService } from './public-booking-replacement.service';

describe('PublicBookingReplacementService', () => {
  const serviceDate = new Date('2026-08-23T00:00:00.000Z');

  function createHarness(input?: {
    individual?: unknown;
    groups?: unknown[];
    otpKey?: string;
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
      activeContextKey: input?.otpKey ?? 'BOOKING:draft-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValueOnce([draft]).mockResolvedValueOnce([otp]),
      appointment: {
        findFirst: jest.fn().mockResolvedValue(input?.individual ?? null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      bookingGroup: {
        findMany: jest.fn().mockResolvedValue(input?.groups ?? []),
        update: jest.fn(),
      },
      otpVerification: { update: jest.fn() },
      bookingDraft: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const identity = {
      deriveAppointmentKey: jest.fn().mockReturnValue('active-key'),
      acquireAppointmentScopeLock: jest.fn(),
    };
    const service = new PublicBookingReplacementService(
      prisma as never,
      identity as never,
    );
    return { service, transaction, identity, draft, otp };
  }

  it('shows the verified individual duplicate without comparing draft names', async () => {
    const appointment = {
      id: 'appointment-1',
      bookingReference: 'BOOK-1',
      queueNumber: 4,
      serviceDate,
      firstName: 'Completely',
      lastName: 'Different',
      practiceLocation: { name: 'North Clinic' },
    };
    const { service, transaction } = createHarness({ individual: appointment });

    await expect(service.describeDuplicate('draft-1')).resolves.toMatchObject({
      duplicate: true,
      context: { kind: 'INDIVIDUAL', appointment },
    });
    expect(transaction.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ activeAppointmentKey: 'active-key' }),
      }),
    );
  });

  it('cancels an active group and converts verification into short-lived replacement authority', async () => {
    const group = {
      id: 'group-1',
      serviceDate,
      practiceLocation: { name: 'North Clinic' },
      appointments: [
        {
          bookingReference: 'BOOK-2',
          queueNumber: 5,
          firstName: 'A',
          lastName: 'One',
          status: 'WAITING',
        },
        {
          bookingReference: 'BOOK-3',
          queueNumber: 6,
          firstName: 'B',
          lastName: 'Two',
          status: 'WAITING',
        },
      ],
    };
    const { service, transaction } = createHarness({ groups: [group] });

    const result = await service.authorizeReplacement('draft-1');

    expect(result).toMatchObject({
      replacementAuthorized: true,
      replayed: false,
      cancelledContext: {
        kind: 'BOOKING_GROUP',
        bookingGroupId: 'group-1',
        queueNumbers: [5, 6],
      },
    });
    expect(transaction.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          servingOrderKey: null,
          waitingPlacementType: null,
          activeAppointmentKey: null,
        }),
      }),
    );
    expect(transaction.bookingGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'group-1' },
        data: expect.objectContaining({ servingProtectionEndedAt: expect.any(Date) }),
      }),
    );
    expect(transaction.otpVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeContextKey: 'REPLACEMENT:draft-1',
          otpHash: null,
          otpHashKeyVersion: null,
        }),
      }),
    );
    expect(transaction.bookingDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: { expiresAt: expect.any(Date) },
      }),
    );
  });

  it('replays an already-authorized replacement without cancelling again', async () => {
    const { service, transaction } = createHarness({
      otpKey: 'REPLACEMENT:draft-1',
    });

    await expect(service.authorizeReplacement('draft-1')).resolves.toMatchObject({
      replacementAuthorized: true,
      replayed: true,
    });
    expect(transaction.appointment.update).not.toHaveBeenCalled();
    expect(transaction.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses destructive replacement when no active public context exists', async () => {
    const { service } = createHarness();

    await expect(service.authorizeReplacement('draft-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
