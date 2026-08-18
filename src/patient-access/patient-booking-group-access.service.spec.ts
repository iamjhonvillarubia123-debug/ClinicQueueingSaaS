import { UnauthorizedException } from '@nestjs/common';
import {
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { PatientBookingGroupAccessService } from './patient-booking-group-access.service';

type TokenFixture = {
  id: string;
  tokenHash: string;
  purpose: BookingGroupAccessTokenPurpose;
  expiresAt: Date;
  revokedAt: Date | null;
  bookingGroup: {
    id: string;
    practiceLocationId: string;
    serviceDate: Date;
    servingProtectionEndedAt: Date | null;
    appointments: Array<{
      bookingReference: string;
      queueNumber: number;
      status: AppointmentStatus;
      servingOrderKey: null;
      waitingPlacementType: WaitingPlacementType;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      suffix: string | null;
    }>;
  };
};

type FindUniqueArgs = {
  select: {
    bookingGroup: {
      select: {
        appointments: {
          where: { anonymizedAt: null };
        };
      };
    };
  };
};

type UpdateArgs = {
  where: { id: string };
  data: { lastUsedAt: Date };
};

describe('PatientBookingGroupAccessService', () => {
  const rawToken = 'a'.repeat(43);

  function buildToken(overrides: Partial<TokenFixture> = {}): TokenFixture {
    const base: TokenFixture = {
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
    };

    return {
      ...base,
      ...overrides,
      bookingGroup: overrides.bookingGroup ?? base.bookingGroup,
    };
  }

  function createService(tokenResult: TokenFixture | null) {
    const update = jest.fn<Promise<{ id: string }>, [UpdateArgs]>(() =>
      Promise.resolve({ id: 'group-token-1' }),
    );
    const findUnique = jest.fn<Promise<TokenFixture | null>, [FindUniqueArgs]>(
      () => Promise.resolve(tokenResult),
    );
    const transaction = {
      bookingGroupAccessToken: {
        findUnique,
        update,
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    return {
      service: new PatientBookingGroupAccessService(prisma as never),
      transaction,
      findUnique,
      update,
    };
  }

  it('authorizes one active controller token and re-reads current visible members', async () => {
    const { service, findUnique, update } = createService(buildToken());

    const access = await service.establish(rawToken);

    expect(access.bookingGroup.id).toBe('group-1');
    expect(access.bookingGroup.members).toHaveLength(1);
    expect(access.bookingGroup.members[0].bookingReference).toBe('BOOK-1');

    const [findArgs] = findUnique.mock.calls[0] ?? [];
    expect(findArgs?.select.bookingGroup.select.appointments.where).toEqual({
      anonymizedAt: null,
    });

    const [updateArgs] = update.mock.calls[0] ?? [];
    expect(updateArgs?.where).toEqual({ id: 'group-token-1' });
    expect(updateArgs?.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it.each<[string, TokenFixture | null]>([
    ['unknown token', null],
    ['revoked token', buildToken({ revokedAt: new Date() })],
    ['expired token', buildToken({ expiresAt: new Date(Date.now() - 1_000) })],
    [
      'group with no controller-visible members',
      buildToken({
        bookingGroup: {
          ...buildToken().bookingGroup,
          appointments: [],
        },
      }),
    ],
  ])(
    'rejects %s with the same generic response',
    async (_label, tokenResult) => {
      const { service, update } = createService(tokenResult);

      await expect(service.establish(rawToken)).rejects.toEqual(
        new UnauthorizedException('Booking group access is unavailable.'),
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

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
