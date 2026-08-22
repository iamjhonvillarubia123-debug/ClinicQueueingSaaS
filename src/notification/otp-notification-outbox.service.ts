import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { NotificationPayloadService } from './notification-payload.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type CreateBookingOtpOutboxInput = {
  otpVerificationId: string;
  practiceLocationId: string;
  recipientMobileEncrypted: string;
  otp: string;
  otpExpiresAt: Date;
  createdAt: Date;
};

@Injectable()
export class OtpNotificationOutboxService {
  constructor(
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async createBookingOtpOutbox(
    transaction: Prisma.TransactionClient,
    input: CreateBookingOtpOutboxInput,
  ): Promise<void> {
    const message = `Your Clinic Queueing verification code is ${input.otp}. It expires in 5 minutes.`;
    const deliveryIdentityKey = createHash('sha256')
      .update(`${NotificationType.OTP_VERIFICATION}|${input.otpVerificationId}`)
      .digest('hex');

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: NotificationType.OTP_VERIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: input.practiceLocationId,
        otpVerificationId: input.otpVerificationId,
        recipientMobileEncrypted: input.recipientMobileEncrypted,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: this.notificationPayload.encryptMessage(message),
        providerIdempotencyKey: `otp-verification:${input.otpVerificationId}`,
        attemptCount: 0,
        nextAttemptAt: input.createdAt,
        expiresAt: new Date(
          input.createdAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
        ),
        createdAt: input.createdAt,
      },
    });
  }
}
