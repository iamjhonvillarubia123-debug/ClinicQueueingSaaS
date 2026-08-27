import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
} from '../../generated/prisma/client';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  FinalizedAttempt,
  NotificationDeliveryAttemptService,
  ProviderAttemptResult,
} from './notification-delivery-attempt.service';
import { NotificationDeliveryPayloadResolverService } from './notification-delivery-payload-resolver.service';
import { ClaimedOutboxRow } from './notification-outbox-claim.service';
import { NotificationPayloadService } from './notification-payload.service';
import {
  NotificationProviderAdapter,
  NotificationProviderSubmissionResult,
} from './notification-provider-adapter';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';

export type NotificationDeliveryResult =
  | FinalizedAttempt
  | {
      notificationLogId: null;
      attemptNumber: null;
      outboxStatus: NotificationOutboxStatus;
    };

@Injectable()
export class NotificationDeliveryWorkerService {
  constructor(
    private readonly mobileNumberService: MobileNumberService,
    private readonly payloadService: NotificationPayloadService,
    private readonly attemptService: NotificationDeliveryAttemptService,
    private readonly submissionBoundaryService: NotificationSubmissionBoundaryService,
    private readonly providerContractService: NotificationProviderContractService,
    @Optional()
    private readonly payloadResolver?: NotificationDeliveryPayloadResolverService,
  ) {}

  async deliverClaimed(
    claimed: ClaimedOutboxRow,
    adapter: NotificationProviderAdapter,
    now?: Date,
  ): Promise<NotificationDeliveryResult> {
    this.providerContractService.assertAdapter(adapter, claimed.channel);

    const submittedAt = now ?? new Date();
    const reservation = await this.submissionBoundaryService.reserveAttempt(
      claimed.id,
      claimed.processingWorkerId,
      submittedAt,
    );

    if (reservation.disposition === 'CANCELLED') {
      return {
        notificationLogId: null,
        attemptNumber: null,
        outboxStatus: reservation.outboxStatus,
      };
    }

    const { recipient, messageBody } = this.resolvePayload(claimed);

    let providerResult: NotificationProviderSubmissionResult;
    try {
      providerResult = await adapter.submit({
        notificationOutboxId: claimed.id,
        notificationType: claimed.notificationType,
        channel: claimed.channel,
        providerIdempotencyKey: claimed.providerIdempotencyKey,
        recipient,
        messageBody,
      });
    } catch {
      providerResult = {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: adapter.providerName,
        providerStatus: 'submission-result-unavailable',
        failureDetailSanitized:
          'Provider submission result was unavailable after the delivery attempt.',
        submittedAt,
        resolvedAt: null,
      };
    }

    this.providerContractService.assertSubmissionResult(
      adapter,
      providerResult,
      [recipient, messageBody],
    );
    const result: ProviderAttemptResult = providerResult;

    const finalizedAt = now ?? new Date();
    return this.attemptService.finalizeReservedAttempt(
      claimed.id,
      claimed.processingWorkerId,
      reservation.attemptNumber,
      result,
      finalizedAt,
    );
  }

  private resolvePayload(claimed: ClaimedOutboxRow): {
    recipient: string;
    messageBody: string;
  } {
    if (this.payloadResolver) {
      return this.payloadResolver.resolve(claimed);
    }

    if (
      claimed.channel !== NotificationChannel.SMS ||
      !claimed.recipientMobileEncrypted ||
      !claimed.messageBodyEncrypted
    ) {
      throw new BadRequestException(
        'Notification protected delivery payload is unavailable.',
      );
    }

    return {
      recipient: this.mobileNumberService.decrypt(
        claimed.recipientMobileEncrypted,
      ),
      messageBody: this.payloadService.decryptMessage(
        claimed.messageBodyEncrypted,
      ),
    };
  }
}
