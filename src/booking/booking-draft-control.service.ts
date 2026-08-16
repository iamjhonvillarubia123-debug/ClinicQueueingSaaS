import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  BookingDraftMode,
  BookingDraftStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type BookingDraftControlCredential = {
  rawToken: string;
  tokenHash: string;
};

export type LockedEditableBookingDraft = {
  id: string;
  mode: BookingDraftMode;
  status: BookingDraftStatus;
  practiceLocationId: string;
  serviceDate: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  draftControlTokenHash: string | null;
};

@Injectable()
export class BookingDraftControlService {
  constructor(private readonly prisma: PrismaService) {}

  issueCredential(): BookingDraftControlCredential {
    const rawToken = randomBytes(32).toString('base64url');
    return {
      rawToken,
      tokenHash: this.hash(rawToken),
    };
  }

  async attachCredential(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    tokenHash: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "BookingDraft"
      SET "draftControlTokenHash" = ${tokenHash}
      WHERE "id" = ${bookingDraftId}
    `);
  }

  async requireEditableDraftForUpdate(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    rawToken: string,
    now = new Date(),
  ): Promise<LockedEditableBookingDraft> {
    const rows = await transaction.$queryRaw<LockedEditableBookingDraft[]>(
      Prisma.sql`
        SELECT
          "id",
          "mode",
          "status",
          "practiceLocationId",
          "serviceDate",
          "expiresAt",
          "consumedAt",
          "cancelledAt",
          "draftControlTokenHash"
        FROM "BookingDraft"
        WHERE "id" = ${bookingDraftId}
        FOR UPDATE
      `,
    );

    const draft = rows[0];
    if (!draft) {
      throw new NotFoundException('Booking draft is not available.');
    }

    this.assertToken(draft.draftControlTokenHash, rawToken);

    if (
      draft.status === BookingDraftStatus.CONSUMED ||
      draft.consumedAt !== null
    ) {
      throw new GoneException('This booking has already been completed.');
    }

    if (
      draft.status === BookingDraftStatus.CANCELLED ||
      draft.cancelledAt !== null
    ) {
      throw new GoneException('This booking draft has been cancelled.');
    }

    if (
      draft.status === BookingDraftStatus.EXPIRED ||
      draft.expiresAt.getTime() <= now.getTime()
    ) {
      throw new GoneException('This booking draft has expired.');
    }

    if (draft.status !== BookingDraftStatus.PENDING_OTP) {
      throw new GoneException('This booking draft is no longer editable.');
    }

    return draft;
  }

  async requireEditableDraft(
    bookingDraftId: string,
    rawToken: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireEditableDraftForUpdate(
        transaction,
        bookingDraftId,
        rawToken,
      );
    });
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  private assertToken(storedHash: string | null, rawToken: string): void {
    if (!storedHash || !rawToken) {
      throw new ForbiddenException('Booking draft access denied.');
    }

    const submittedHash = this.hash(rawToken);
    const stored = Buffer.from(storedHash, 'hex');
    const submitted = Buffer.from(submittedHash, 'hex');

    if (
      stored.length !== 32 ||
      submitted.length !== 32 ||
      !timingSafeEqual(stored, submitted)
    ) {
      throw new ForbiddenException('Booking draft access denied.');
    }
  }
}
