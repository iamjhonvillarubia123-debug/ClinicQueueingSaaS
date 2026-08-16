import { ConflictException } from '@nestjs/common';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';

describe('IndividualBookingConfirmationService', () => {
  it('replays a committed result without minting another access token', async () => {
    const appointment = {
      id: 'appointment-1',
      bookingReference: 'BK-1',
      practiceLocationId: 'location-1',
      serviceDate: new Date('2026-08-20T00:00:00.000Z'),
      queueNumber: 12,
      status: 'WAITING',
    };
    const transaction = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue(appointment),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    const idempotency = {
      normalizeKey: jest.fn().mockReturnValue('idem-1'),
      deriveIdentity: jest.fn().mockReturnValue('identity-1'),
      fingerprint: jest.fn().mockReturnValue('fingerprint-1'),
      acquireCommandLock: jest.fn().mockResolvedValue(undefined),
      findReplay: jest.fn().mockResolvedValue({
        resultAppointmentId: 'appointment-1',
      }),
    };
    const accessTokens = {
      issueInitialToken: jest.fn(),
    };
    const service = new IndividualBookingConfirmationService(
      prisma as never,
      idempotency as never,
      {} as never,
      {} as never,
      accessTokens as never,
      {} as never,
    );

    const result = await service.confirm({
      bookingDraftId: 'draft-1',
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({
      appointment,
      bookingAccessToken: null,
      replayed: true,
    });
    expect(accessTokens.issueInitialToken).not.toHaveBeenCalled();
  });

  it('fails closed when the committed replay target no longer exists', async () => {
    const transaction = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    const idempotency = {
      normalizeKey: jest.fn().mockReturnValue('idem-1'),
      deriveIdentity: jest.fn().mockReturnValue('identity-1'),
      fingerprint: jest.fn().mockReturnValue('fingerprint-1'),
      acquireCommandLock: jest.fn().mockResolvedValue(undefined),
      findReplay: jest.fn().mockResolvedValue({
        resultAppointmentId: 'appointment-missing',
      }),
    };
    const service = new IndividualBookingConfirmationService(
      prisma as never,
      idempotency as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.confirm({
        bookingDraftId: 'draft-1',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
