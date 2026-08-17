import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

const ACCESS_TOKEN_BYTES = 32;
const ACCESS_EXPIRY_AFTER_SERVICE_DATE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class BookingGroupAccessTokenIssuerService {
  async issueInitialToken(
    transaction: TransactionClient,
    bookingGroupId: string,
    serviceDate: Date,
  ): Promise<{ rawToken: string; tokenRecordId: string; expiresAt: Date }> {
    const rawToken = randomBytes(ACCESS_TOKEN_BYTES).toString('base64url');
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const expiresAt = new Date(
      serviceDate.getTime() + ACCESS_EXPIRY_AFTER_SERVICE_DATE_MS,
    );

    const tokenRecord = await transaction.bookingGroupAccessToken.create({
      data: {
        bookingGroupId,
        tokenHash,
        purpose: 'CONTROLLER_ACCESS',
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    return {
      rawToken,
      tokenRecordId: tokenRecord.id,
      expiresAt: tokenRecord.expiresAt,
    };
  }
}
