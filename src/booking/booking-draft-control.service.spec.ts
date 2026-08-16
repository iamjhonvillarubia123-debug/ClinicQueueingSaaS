import { ForbiddenException, GoneException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  BookingDraftMode,
  BookingDraftStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingDraftControlService } from './booking-draft-control.service';

describe('BookingDraftControlService', () => {
  const prismaMock = { $transaction: jest.fn() };
  const transactionMock = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  let service: BookingDraftControlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingDraftControlService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('issues a high-entropy browser token and a SHA-256 hash', () => {
    const credential = service.issueCredential();

    expect(credential.rawToken.length).toBeGreaterThanOrEqual(40);
    expect(credential.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.tokenHash).toBe(
      createHash('sha256').update(credential.rawToken, 'utf8').digest('hex'),
    );
  });

  it('accepts the correct token for an editable unexpired draft', async () => {
    const rawToken = 'browser-secret';
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    transactionMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        mode: BookingDraftMode.INDIVIDUAL,
        status: BookingDraftStatus.PENDING_OTP,
        practiceLocationId: 'location-1',
        serviceDate: new Date('2026-08-17T00:00:00.000Z'),
        expiresAt: new Date('2026-08-17T14:00:00.000Z'),
        consumedAt: null,
        cancelledAt: null,
        draftControlTokenHash: tokenHash,
      },
    ]);

    await expect(
      service.requireEditableDraftForUpdate(
        transactionMock as never,
        'draft-1',
        rawToken,
        new Date('2026-08-17T13:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ id: 'draft-1' });
  });

  it('rejects a wrong browser-local token without exposing draft state', async () => {
    const tokenHash = createHash('sha256')
      .update('correct-secret', 'utf8')
      .digest('hex');
    transactionMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        mode: BookingDraftMode.INDIVIDUAL,
        status: BookingDraftStatus.PENDING_OTP,
        practiceLocationId: 'location-1',
        serviceDate: new Date('2026-08-17T00:00:00.000Z'),
        expiresAt: new Date('2026-08-17T14:00:00.000Z'),
        consumedAt: null,
        cancelledAt: null,
        draftControlTokenHash: tokenHash,
      },
    ]);

    await expect(
      service.requireEditableDraftForUpdate(
        transactionMock as never,
        'draft-1',
        'wrong-secret',
        new Date('2026-08-17T13:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permanently rejects a consumed draft even with the correct token', async () => {
    const rawToken = 'browser-secret';
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    transactionMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        mode: BookingDraftMode.INDIVIDUAL,
        status: BookingDraftStatus.CONSUMED,
        practiceLocationId: 'location-1',
        serviceDate: new Date('2026-08-17T00:00:00.000Z'),
        expiresAt: new Date('2026-08-17T14:00:00.000Z'),
        consumedAt: new Date('2026-08-17T13:05:00.000Z'),
        cancelledAt: null,
        draftControlTokenHash: tokenHash,
      },
    ]);

    await expect(
      service.requireEditableDraftForUpdate(
        transactionMock as never,
        'draft-1',
        rawToken,
        new Date('2026-08-17T13:10:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
