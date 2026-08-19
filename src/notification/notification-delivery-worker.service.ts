import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
} from '../../generated/prisma/client';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  FinalizedAttempt,
  NotificationDeliveryAttemptService,
  ProviderAttemptResult,
} from './notification-delivery-attempt.service';
import { ClaimedOutboxRow } from './notification-outbox-claim.service';
import { NotificationPayloadService } from './notification-payload.service';
import { NotificationProviderAdapter } from './notification-provider-adapter';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';

@Injectable()
export class NotificationDeliveryWorkerService {
  constructor(
    private readonly mobileNumberService: MobileNumberService,
    private readonly payloadService: NotificationPayloadService,
    private readonly attemptService: NotificationDeliveryAttemptService,
    private readonly submissionBoundaryService: NotificationSubmissionBoundaryService,
  ) {}

  async deliverClaimed(
    claimed: ClaimedOutboxRow,
    adapter: NotificationProviderAdapter,
    now?: Date,
  ): Promise<FinalizedAttempt> {
    if (claimed.channel !== adapter.channel) {
      throw new BadRequestException(
        'Notification provider adapter channel does not match the claimed outbox.',
      );
    }
    if (claimed.channel !== NotificationChannel.SMS) {
      throw new BadRequestException(
        'Notification delivery orchestration currently supports SMS only.',
      );
    }
    if (!claimed.recipientMobileEncrypted || !claimed.messageBodyEncrypted) {
      throw new BadRequestException(
        'Notification protected delivery payload is unavailable.',
      );
    }

    const submittedAt = now ?? new Date();
    const recipient = this.mobileNumberService.decrypt(
      claimed.recipientMobileEncrypted,
    );
    const messageBody = this.payloadService.decryptMessage(
      claimed.messageBodyEncrypted,
    );

    const reservation = await this.submissionBoundaryService.reserveAttempt(
      claimed.id,
      claimed.processingWorkerId,
      submittedAt,
    );

    let result: ProviderAttemptResult;
    try {
      result = await adapter.submit({
        notificationOutboxId: claimed.id,
        notificationType: claimed.notificationType,
        channel: claimed.channel,
        providerIdempotencyKey: claimed.providerIdempotencyKey,
        recipient,
        messageBody,
      });
    } catch {
      result = {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: adapter.providerName,
        providerStatus: 'submission-result-unavailable',
        failureDetailSanitized:
          'Provider submission result was unavailable after the delivery attempt.',
        submittedAt,
        resolvedAt: null,
      };
    }

    const finalizedAt = now ?? new Date();
    return this.attemptService.finalizeReservedAttempt(
      claimed.id,
      claimed.processingWorkerId,
      reservation.attemptNumber,
      result,
      finalizedAt,
    );
  }
}
