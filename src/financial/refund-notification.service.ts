import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL_PURPOSE = 'notification-outbox:recipient-email';

type RefundNotificationType =
  | typeof NotificationType.REFUND_REQUEST_SUBMITTED
  | typeof NotificationType.REFUND_COMPLETED
  | typeof NotificationType.REFUND_FAILED;

@Injectable()
export class RefundNotificationService {
  constructor(
    private readonly protectedAccountPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async create(
    transaction: Prisma.TransactionClient,
    input: {
      notificationType: RefundNotificationType;
      refundRequestId: string;
      recipientEmail: string;
      message: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    if (!input.refundRequestId.trim() || !input.recipientEmail.trim()) {
      throw new BadRequestException('Refund notification source is invalid.');
    }

    const deliveryIdentityKey = this.sha256(
      `${input.notificationType}|${input.refundRequestId}`,
    );
    const existing = await transaction.notificationOutbox.findUnique({
      where: { deliveryIdentityKey },
      select: { id: true },
    });
    if (existing) return;

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: input.notificationType,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        refundRequestId: input.refundRequestId,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: this.protectedAccountPayload.encrypt(
          input.recipientEmail.trim(),
          RECIPIENT_EMAIL_PURPOSE,
        ),
        messageBodyEncrypted: this.notificationPayload.encryptMessage(
          input.message,
        ),
        providerIdempotencyKey: `financial:${deliveryIdentityKey}`,
        attemptCount: 0,
        nextAttemptAt: input.occurredAt,
        expiresAt: new Date(
          input.occurredAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
        ),
        createdAt: input.occurredAt,
      },
    });
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
