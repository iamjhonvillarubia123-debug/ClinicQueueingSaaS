import { BadRequestException, ConflictException } from '@nestjs/common';
import { CommandType } from '../../generated/prisma/client';
import { CommandIdempotencyService } from './command-idempotency.service';

describe('CommandIdempotencyService', () => {
  const service = new CommandIdempotencyService();

  it('normalizes a valid idempotency key', () => {
    expect(service.normalizeKey('  command-123  ')).toBe('command-123');
  });

  it('rejects a missing idempotency key', () => {
    expect(() => service.normalizeKey(undefined)).toThrow(BadRequestException);
  });

  it('derives the same identity regardless of object key insertion order', () => {
    const left = service.deriveIdentity({
      idempotencyKey: 'same-key',
      commandType: CommandType.CONVERT_BOOKING_DRAFT,
      scope: { bookingDraftId: 'draft-1', practiceLocationId: 'location-1' },
    });
    const right = service.deriveIdentity({
      idempotencyKey: 'same-key',
      commandType: CommandType.CONVERT_BOOKING_DRAFT,
      scope: { practiceLocationId: 'location-1', bookingDraftId: 'draft-1' },
    });

    expect(left).toBe(right);
  });

  it('preserves array order in request fingerprints', () => {
    const left = service.fingerprint({ members: ['A', 'B'] });
    const right = service.fingerprint({ members: ['B', 'A'] });

    expect(left).not.toBe(right);
  });

  it('excludes undefined but preserves explicit null', () => {
    expect(service.fingerprint({ value: undefined })).toBe(
      service.fingerprint({}),
    );
    expect(service.fingerprint({ value: null })).not.toBe(
      service.fingerprint({}),
    );
  });

  it('returns compatible persisted replay and rejects incompatible replay', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      requestFingerprint: 'fingerprint-a',
    });
    const transaction = {
      commandIdempotency: { findUnique },
    } as never;

    await expect(
      service.findReplay(transaction, 'identity', 'fingerprint-a'),
    ).resolves.toEqual({ requestFingerprint: 'fingerprint-a' });

    await expect(
      service.findReplay(transaction, 'identity', 'fingerprint-b'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sets technical expiry to exactly seven days after completion', () => {
    const now = new Date('2026-08-17T00:00:00.000Z');
    const times = service.completionTimes(now);

    expect(times.completedAt).toEqual(now);
    expect(times.expiresAt.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });
});
