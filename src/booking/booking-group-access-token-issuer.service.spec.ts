import { createHash } from 'crypto';
import { BookingGroupAccessTokenIssuerService } from './booking-group-access-token-issuer.service';

describe('BookingGroupAccessTokenIssuerService', () => {
  it('creates one opaque controller token with seven-day post-service expiry', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'group-token-1',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    });
    const service = new BookingGroupAccessTokenIssuerService();
    const serviceDate = new Date('2026-08-20T00:00:00.000Z');

    const result = await service.issueInitialToken(
      { bookingGroupAccessToken: { create } } as never,
      'group-1',
      serviceDate,
    );

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.rawToken.length).toBeGreaterThan(30);
    expect(result.tokenRecordId).toBe('group-token-1');
    expect(result.expiresAt).toEqual(new Date('2026-08-27T00:00:00.000Z'));

    const expectedHash = createHash('sha256')
      .update(result.rawToken, 'utf8')
      .digest('hex');
    expect(create).toHaveBeenCalledWith({
      data: {
        bookingGroupId: 'group-1',
        tokenHash: expectedHash,
        purpose: 'CONTROLLER_ACCESS',
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
      select: { id: true, expiresAt: true },
    });
  });
});
