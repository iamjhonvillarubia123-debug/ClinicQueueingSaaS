import { BookingAccessTokenIssuerService } from './booking-access-token-issuer.service';

describe('BookingAccessTokenIssuerService', () => {
  const service = new BookingAccessTokenIssuerService();

  it('stores only a protected token representation and returns the raw credential once', async () => {
    let persistedTokenHash: string | undefined;
    const create = jest.fn(
      (args: {
        data: {
          appointmentId: string;
          purpose: string;
          tokenHash: string;
          expiresAt: Date;
        };
        select: { id: boolean; expiresAt: boolean };
      }) => {
        persistedTokenHash = args.data.tokenHash;
        return Promise.resolve({
          id: 'token-record-1',
          expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        });
      },
    );
    const transaction = { bookingAccessToken: { create } };

    const result = await service.issueInitialToken(
      transaction as never,
      'appointment-1',
      new Date('2026-08-20T00:00:00.000Z'),
    );

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.rawToken.length).toBeGreaterThanOrEqual(40);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appointmentId: 'appointment-1',
          purpose: 'VIEW_AND_MANAGE_BOOKING',
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }) as unknown,
      }),
    );
    expect(persistedTokenHash).not.toBe(result.rawToken);
  });
});
