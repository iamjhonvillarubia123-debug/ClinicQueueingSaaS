import { ConflictException } from '@nestjs/common';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';

describe('IndividualBookingConfirmationService', () => {
  const createIdempotencyDouble = (resultAppointmentId: string) => {
    const service = new CommandIdempotencyService();

    jest.spyOn(service, 'normalizeKey').mockReturnValue('idem-1');
    jest.spyOn(service, 'deriveIdentity').mockReturnValue('identity-1');
    jest.spyOn(service, 'fingerprint').mockReturnValue('fingerprint-1');
    jest.spyOn(service, 'acquireCommandLock').mockResolvedValue(undefined);
    jest.spyOn(service, 'findReplay').mockResolvedValue({
      resultAppointmentId,
    } as never);

    return service;
  };

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
    const idempotency = createIdempotencyDouble('appointment-1');
    const accessTokens = {
      issueInitialToken: jest.fn(),
    };
    const service = new IndividualBookingConfirmationService(
      prisma as never,
      idempotency,
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
    const idempotency = createIdempotencyDouble('appointment-missing');
    const service = new IndividualBookingConfirmationService(
      prisma as never,
      idempotency,
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
