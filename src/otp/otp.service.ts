import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  timingSafeEqual,
} from 'crypto';

import { OtpGenerator } from './otp.generator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpService {
  private readonly otpHmacKey: Buffer;
  private readonly activeKeyId: string;

  constructor(
  private readonly otpGenerator: OtpGenerator,
  private readonly configService: ConfigService,
  private readonly prisma: PrismaService,
) {
    const otpKeyBase64 =
      this.configService.getOrThrow<string>(
        'OTP_HMAC_KEY_V1',
      );

    const activeKeyId =
      this.configService.getOrThrow<string>(
        'OTP_HMAC_ACTIVE_KEY_ID',
      );

    const otpKey = Buffer.from(
      otpKeyBase64,
      'base64',
    );

    if (otpKey.length !== 32) {
      throw new Error(
        'OTP_HMAC_KEY_V1 must decode to exactly 32 bytes.',
      );
    }

    if (!activeKeyId.trim()) {
      throw new Error(
        'OTP_HMAC_ACTIVE_KEY_ID must not be blank.',
      );
    }

    this.otpHmacKey = otpKey;
    this.activeKeyId = activeKeyId.trim();
  }

  hashOtp(
    bookingDraftId: string,
    purpose: string,
    otp: string,
  ): string {
    const input =
      `${bookingDraftId}:${purpose}:${otp}`;

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
    const calculatedHash = this.hashOtp(
      bookingDraftId,
      purpose,
      otp,
    );

    try {
      const calculatedBuffer = Buffer.from(
        calculatedHash,
        'hex',
      );

      const storedBuffer = Buffer.from(
        storedHash,
        'hex',
      );

      if (
        calculatedBuffer.length !==
          storedBuffer.length ||
        calculatedBuffer.length !== 32
      ) {
        return false;
      }

      return timingSafeEqual(
        calculatedBuffer,
        storedBuffer,
      );
    } catch {
      return false;
    }
  }
  async createBookingOtp(bookingDraftId: string) {
  const now = new Date();

  const otpExpiresAt = new Date(
    now.getTime() + 5 * 60 * 1000,
  );

  return this.prisma.$transaction(
    async (transaction) => {
      const bookingDraft =
        await transaction.bookingDraft.findFirst({
          where: {
            id: bookingDraftId,
            status: 'PENDING_OTP',
            expiresAt: {
              gt: now,
            },
            consumedAt: null,
            cancelledAt: null,
          },
          select: {
            id: true,
            mobileNumberHash: true,
          },
        });

      if (!bookingDraft?.mobileNumberHash) {
        throw new NotFoundException(
          'Booking draft is not available for OTP verification.',
        );
      }

      await transaction.otpVerification.updateMany({
        where: {
          bookingDraftId: bookingDraft.id,
          purpose: 'BOOKING_VERIFICATION',
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: {
          invalidatedAt: now,
        },
      });

      const otp = this.otpGenerator.generate();

      const otpHash = this.hashOtp(
        bookingDraft.id,
        'BOOKING_VERIFICATION',
        otp,
      );

      const otpVerification =
        await transaction.otpVerification.create({
          data: {
            bookingDraftId: bookingDraft.id,
            mobileNumberHash:
              bookingDraft.mobileNumberHash,
            otpHash,
            purpose: 'BOOKING_VERIFICATION',
            expiresAt: otpExpiresAt,
          },
          select: {
            id: true,
            bookingDraftId: true,
            purpose: true,
            expiresAt: true,
            attemptCount: true,
            maxAttempts: true,
            createdAt: true,
          },
        });

      return {
        otp,
        otpVerification,
      };
    },
  );
}

async verifyBookingOtp(
  bookingDraftId: string,
  submittedOtp: string,
) {
  const now = new Date();

  return this.prisma.$transaction(
    async (transaction) => {
      const otpVerification =
        await transaction.otpVerification.findFirst({
          where: {
            bookingDraftId,
            purpose: 'BOOKING_VERIFICATION',
            verifiedAt: null,
            consumedAt: null,
            invalidatedAt: null,
            expiresAt: {
              gt: now,
            },
            attemptCount: {
              lt: 5,
            },
            bookingDraft: {
              status: 'PENDING_OTP',
              expiresAt: {
                gt: now,
              },
              consumedAt: null,
              cancelledAt: null,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            bookingDraftId: true,
            otpHash: true,
            purpose: true,
            attemptCount: true,
            maxAttempts: true,
          },
        });

      if (!otpVerification) {
        throw new BadRequestException(
          'OTP verification failed.',
        );
      }

      const matches = this.verifyOtpHash(
        otpVerification.bookingDraftId,
        otpVerification.purpose,
        submittedOtp,
        otpVerification.otpHash,
      );

      if (!matches) {
        const nextAttemptCount =
          otpVerification.attemptCount + 1;

        await transaction.otpVerification.update({
          where: {
            id: otpVerification.id,
          },
          data: {
            attemptCount: {
              increment: 1,
            },
            invalidatedAt:
              nextAttemptCount >=
              otpVerification.maxAttempts
                ? now
                : null,
          },
        });

        throw new BadRequestException(
          'OTP verification failed.',
        );
      }

      const verifiedOtp =
        await transaction.otpVerification.update({
          where: {
            id: otpVerification.id,
          },
          data: {
            verifiedAt: now,
          },
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
    },
  );
}
}