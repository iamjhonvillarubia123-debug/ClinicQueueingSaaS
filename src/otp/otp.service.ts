import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import { OtpNotificationOutboxService } from '../notification/otp-notification-outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpGenerator } from './otp.generator';

const OTP_LIFETIME_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const CONTEXT_WINDOW_MS = 30 * 60 * 1000;
const MOBILE_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MOBILE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_CHALLENGE = 5;
const MAX_FAILED_SUBMISSIONS_PER_CONTEXT = 10;
const MAX_CHALLENGES_PER_CONTEXT = 5;
const MAX_CHALLENGES_PER_MOBILE_HOUR = 10;
const MAX_CHALLENGES_PER_MOBILE_DAY = 20;

const BOOKING_PURPOSE = 'BOOKING';
const OTP_REQUEST_UNAVAILABLE =
  'OTP request is unavailable. Please try again later.';
const OTP_VERIFICATION_FAILED = 'OTP verification failed.';

type LockedBookingDraft = {
  id: string;
  status: string;
  practiceLocationId: string;
  mobileNumberEncrypted: string | null;
  mobileNumberHash: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
};

type LockedBookingOtp = {
  id: string;
  bookingDraftId: string | null;
  otpHash: string | null;
  purpose: string;
  activeContextKey: string | null;
  attemptCount: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

@Injectable()
export class OtpService {
  private readonly otpHmacKey: Buffer;
  private readonly activeKeyId: string;
  private readonly activeKeyVersion = 1;

  constructor(
    private readonly otpGenerator: OtpGenerator,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly otpNotificationOutbox: OtpNotificationOutboxService,
  ) {
    const otpKeyBase64 =
      this.configService.getOrThrow<string>('OTP_HMAC_KEY_V1');
    const activeKeyId = this.configService.getOrThrow<string>(
      'OTP_HMAC_ACTIVE_KEY_ID',
    );
    const otpKey = Buffer.from(otpKeyBase64, 'base64');

    if (otpKey.length !== 32) {
      throw new Error('OTP_HMAC_KEY_V1 must decode to exactly 32 bytes.');
    }
    if (!activeKeyId.trim()) {
      throw new Error('OTP_HMAC_ACTIVE_KEY_ID must not be blank.');
    }

    this.otpHmacKey = otpKey;
    this.activeKeyId = activeKeyId.trim();
  }

  hashOtp(bookingDraftId: string, purpose: string, otp: string): string {
    const input = `${bookingDraftId}:${purpose}:${otp}`;

    return createHmac('sha256', this.otpHmacKey)
      .update(input, 'utf8')
      .digest('hex');
  }

  verifyOtpHash(
    bookingDraftId: string,
    purpose: string,
    otp: string,
    storedHash: string,
  ): boolean {
    const calculatedHash = this.hashOtp(bookingDraftId, purpose, otp);

    try {
      const calculatedBuffer = Buffer.from(calculatedHash, 'hex');
      const storedBuffer = Buffer.from(storedHash, 'hex');

      if (
        calculatedBuffer.length !== storedBuffer.length ||
        calculatedBuffer.length !== 32
      ) {
        return false;
      }

      return timingSafeEqual(calculatedBuffer, storedBuffer);
    } catch {
      return false;
    }
  }

  async createBookingOtp(bookingDraftId: string) {
    return this.prisma.$transaction((transaction) =>
      this.createBookingOtpInTransaction(transaction, bookingDraftId),
    );
  }

  async createBookingOtpInTransaction(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
  ) {
    const now = new Date();
    const bookingDraft = await this.lockActiveBookingDraft(
      transaction,
      bookingDraftId,
      now,
    );

    await this.assertBookingIssueLimits(transaction, bookingDraft, now);

    const activeContextKey = this.bookingActiveContextKey(bookingDraft.id);
    const activeChallenge = await transaction.otpVerification.findFirst({
      where: { activeContextKey },
      select: {
        id: true,
        verifiedAt: true,
        invalidatedAt: true,
        consumedAt: true,
      },
    });

    if (
      activeChallenge?.verifiedAt &&
      !activeChallenge.invalidatedAt &&
      !activeChallenge.consumedAt
    ) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }

    await transaction.otpVerification.updateMany({
      where: {
        bookingDraftId: bookingDraft.id,
        purpose: BOOKING_PURPOSE,
        activeContextKey,
      },
      data: {
        invalidatedAt: now,
        activeContextKey: null,
        otpHash: null,
      },
    });

    const otp = this.otpGenerator.generate();
    const otpHash = this.hashOtp(bookingDraft.id, BOOKING_PURPOSE, otp);
    const otpExpiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);

    const otpVerification = await transaction.otpVerification.create({
      data: {
        bookingDraftId: bookingDraft.id,
        mobileNumberHash: bookingDraft.mobileNumberHash,
        mobileHashKeyVersion: 1,
        otpHash,
        otpHashKeyVersion: this.activeKeyVersion,
        purpose: BOOKING_PURPOSE,
        activeContextKey,
        expiresAt: otpExpiresAt,
      },
      select: {
        id: true,
        bookingDraftId: true,
        purpose: true,
        expiresAt: true,
        attemptCount: true,
        createdAt: true,
      },
    });

    await this.otpNotificationOutbox.createBookingOtpOutbox(transaction, {
      otpVerificationId: otpVerification.id,
      practiceLocationId: bookingDraft.practiceLocationId,
      recipientMobileEncrypted: bookingDraft.mobileNumberEncrypted,
      otp,
      createdAt: now,
    });

    return { otp, otpVerification };
  }

  async verifyBookingOtp(bookingDraftId: string, submittedOtp: string) {
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      await this.lockActiveBookingDraft(transaction, bookingDraftId, now);

      const activeContextKey = this.bookingActiveContextKey(bookingDraftId);
      const rows = await transaction.$queryRaw<LockedBookingOtp[]>(Prisma.sql`
        SELECT
          "id",
          "bookingDraftId",
          "otpHash",
          "purpose",
          "activeContextKey",
          "attemptCount",
          "expiresAt",
          "verifiedAt",
          "consumedAt",
          "invalidatedAt"
        FROM "OtpVerification"
        WHERE "activeContextKey" = ${activeContextKey}
        FOR UPDATE
      `);

      const otpVerification = rows[0];
      if (
        !otpVerification ||
        otpVerification.purpose !== BOOKING_PURPOSE ||
        otpVerification.bookingDraftId !== bookingDraftId ||
        otpVerification.verifiedAt ||
        otpVerification.consumedAt ||
        otpVerification.invalidatedAt ||
        !otpVerification.otpHash ||
        otpVerification.attemptCount >= MAX_ATTEMPTS_PER_CHALLENGE
      ) {
        throw new BadRequestException(OTP_VERIFICATION_FAILED);
      }

      if (otpVerification.expiresAt.getTime() <= now.getTime()) {
        await transaction.otpVerification.update({
          where: { id: otpVerification.id },
          data: {
            activeContextKey: null,
            otpHash: null,
          },
        });
        throw new BadRequestException(OTP_VERIFICATION_FAILED);
      }

      const contextFailureCount = await this.contextFailureCount(
        transaction,
        bookingDraftId,
        now,
      );
      if (contextFailureCount >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT) {
        await transaction.otpVerification.update({
          where: { id: otpVerification.id },
          data: {
            invalidatedAt: now,
            activeContextKey: null,
            otpHash: null,
          },
        });
        throw new BadRequestException(OTP_VERIFICATION_FAILED);
      }

      const matches = this.verifyOtpHash(
        bookingDraftId,
        BOOKING_PURPOSE,
        submittedOtp,
        otpVerification.otpHash,
      );

      if (!matches) {
        const nextAttemptCount = otpVerification.attemptCount + 1;
        const nextContextFailureCount = contextFailureCount + 1;
        const invalidate =
          nextAttemptCount >= MAX_ATTEMPTS_PER_CHALLENGE ||
          nextContextFailureCount >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT;

        await transaction.otpVerification.update({
          where: { id: otpVerification.id },
          data: {
            attemptCount: { increment: 1 },
            ...(invalidate
              ? {
                  invalidatedAt: now,
                  activeContextKey: null,
                  otpHash: null,
                }
              : {}),
          },
        });

        throw new BadRequestException(OTP_VERIFICATION_FAILED);
      }

      const verifiedOtp = await transaction.otpVerification.update({
        where: { id: otpVerification.id },
        data: { verifiedAt: now },
        select: {
          id: true,
          bookingDraftId: true,
          purpose: true,
          verifiedAt: true,
        },
      });

      return {
        message: 'OTP verified successfully.',
        otpVerification: verifiedOtp,
      };
    });
  }

  private async lockActiveBookingDraft(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    now: Date,
  ): Promise<LockedBookingDraft> {
    const rows = await transaction.$queryRaw<LockedBookingDraft[]>(Prisma.sql`
      SELECT
        "id",
        "status",
        "practiceLocationId",
        "mobileNumberEncrypted",
        "mobileNumberHash",
        "expiresAt",
        "consumedAt",
        "cancelledAt"
      FROM "BookingDraft"
      WHERE "id" = ${bookingDraftId}
      FOR UPDATE
    `);

    const bookingDraft = rows[0];
    if (
      !bookingDraft ||
      bookingDraft.status !== 'PENDING_OTP' ||
      !bookingDraft.practiceLocationId ||
      !bookingDraft.mobileNumberEncrypted ||
      !bookingDraft.mobileNumberHash ||
      bookingDraft.expiresAt.getTime() <= now.getTime() ||
      bookingDraft.consumedAt ||
      bookingDraft.cancelledAt
    ) {
      throw new NotFoundException(
        'Booking draft is not available for OTP verification.',
      );
    }

    return bookingDraft;
  }

  private async assertBookingIssueLimits(
    transaction: Prisma.TransactionClient,
    bookingDraft: LockedBookingDraft,
    now: Date,
  ): Promise<void> {
    const contextWindowStart = new Date(now.getTime() - CONTEXT_WINDOW_MS);
    const mobileHourStart = new Date(now.getTime() - MOBILE_HOURLY_WINDOW_MS);
    const mobileDayStart = new Date(now.getTime() - MOBILE_DAILY_WINDOW_MS);

    const latestChallenge = await transaction.otpVerification.findFirst({
      where: {
        bookingDraftId: bookingDraft.id,
        purpose: BOOKING_PURPOSE,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      latestChallenge &&
      now.getTime() - latestChallenge.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }

    const contextChallengeCount = await transaction.otpVerification.count({
      where: {
        bookingDraftId: bookingDraft.id,
        purpose: BOOKING_PURPOSE,
        createdAt: { gte: contextWindowStart },
      },
    });
    if (contextChallengeCount >= MAX_CHALLENGES_PER_CONTEXT) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }

    const mobileHourCount = await transaction.otpVerification.count({
      where: {
        mobileNumberHash: bookingDraft.mobileNumberHash,
        createdAt: { gte: mobileHourStart },
      },
    });
    if (mobileHourCount >= MAX_CHALLENGES_PER_MOBILE_HOUR) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }

    const mobileDayCount = await transaction.otpVerification.count({
      where: {
        mobileNumberHash: bookingDraft.mobileNumberHash,
        createdAt: { gte: mobileDayStart },
      },
    });
    if (mobileDayCount >= MAX_CHALLENGES_PER_MOBILE_DAY) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }

    const failures = await this.contextFailureCount(
      transaction,
      bookingDraft.id,
      now,
    );
    if (failures >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT) {
      throw new BadRequestException(OTP_REQUEST_UNAVAILABLE);
    }
  }

  private async contextFailureCount(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    now: Date,
  ): Promise<number> {
    const result = await transaction.otpVerification.aggregate({
      where: {
        bookingDraftId,
        purpose: BOOKING_PURPOSE,
        createdAt: {
          gte: new Date(now.getTime() - CONTEXT_WINDOW_MS),
        },
      },
      _sum: { attemptCount: true },
    });

    return result._sum.attemptCount ?? 0;
  }

  private bookingActiveContextKey(bookingDraftId: string): string {
    return `BOOKING:${bookingDraftId}`;
  }
}
