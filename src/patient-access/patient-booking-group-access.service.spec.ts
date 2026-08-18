import { UnauthorizedException } from '@nestjs/common';
import {
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { PatientBookingGroupAccessService } from './patient-booking-group-access.service';

describe('PatientBookingGroupAccessService', () => {
  const rawToken = 'a'.repeat(43);

  function buildToken(overrides: Record<string, unknown> = {}) {
    return {
      id: 'group-token-1',
      tokenHash: 'present',
      purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      bookingGroup: {
        id: 'group-1',
        practiceLocationId: 'location-1',
        serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        servingProtectionEndedAt: null,
        appointments: [
          {
            bookingReference: 'BOOK-1',
            queueNumber: 11,
            status: AppointmentStatus.WAITING,
            servingOrderKey: null,
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: 'Ana',
            middleName: null,
            lastName: 'Santos',
            suffix: null,
          },
        ],
      },
      ...overrides,
    };
  }

  function createService(tokenResult: unknown) {
    const update = jest.fn().mockResolvedValue({ id: 'group-token-1' });
    const transaction = {
      bookingGroupAccessToken: {
        findUnique: jest.fn().mockResolvedValue(tokenResult),
        update,
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    return {
      service: new PatientBookingGroupAccessService(prisma as never),
      transaction,
      update,
    };
  }

  it('authorizes one active controller token and re-reads current visible members', async () => {
    const { service, transaction, update } = createService(buildToken());

    const access = await service.establish(rawToken);

    expect(access.bookingGroup.id).toBe('group-1');
    expect(access.bookingGroup.members).toHaveLength(1);
    expect(access.bookingGroup.members[0].bookingReference).toBe('BOOK-1');
    expect(transaction.bookingGroupAccessToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          bookingGroup: expect.objectContaining({
            select: expect.objectContaining({
              appointments: expect.objectContaining({
                where: { anonymizedAt: null },
              }),
            }),
          }),
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'group-token-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it.each([
    ['unknown token', null],
    ['revoked token', buildToken({ revokedAt: new Date() })],
    ['expired token', buildToken({ expiresAt: new Date(Date.now() - 1_000) })],
    ['wrong-purpose token', buildToken({ purpose: 'NOT_CONTROLLER_ACCESS' })],
    [
      'group with no controller-visible members',
      buildToken({
        bookingGroup: {
          ...buildToken().bookingGroup,
          appointments: [],
        },
      }),
    ],
  ])('rejects %s with the same generic response', async (_label, tokenResult) => {
    const { service, update } = createService(tokenResult);

    await expect(service.establish(rawToken)).rejects.toEqual(
      new UnauthorizedException('Booking group access is unavailable.'),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a valid token when a different BookingGroup is requested', async () => {
    const { service, transaction, update } = createService(buildToken());

    await expect(
      service.validateControllerToken(
        transaction as never,
        rawToken,
        'group-2',
      ),
    ).rejects.toEqual(
      new UnauthorizedException('Booking group access is unavailable.'),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts only its dedicated group cookie and rejects malformed bearer material', () => {
    const { service } = createService(buildToken());

    expect(
      service.readCookie(`other=x; cq_booking_group_access=${rawToken}`),
    ).toBe(rawToken);
    expect(() => service.readCookie('cq_booking_group_access=short')).toThrow(
      UnauthorizedException,
    );
  });
});
