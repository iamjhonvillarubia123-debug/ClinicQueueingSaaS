import { Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationOutboxStatus,
} from '../../generated/prisma/client';
import {
  FinalizedAttempt,
  NotificationDeliveryAttemptService,
  ProviderAttemptResult,
} from './notification-delivery-attempt.service';
import { NotificationDeliveryPayloadResolverService } from './notification-delivery-payload-resolver.service';
import { ClaimedOutboxRow } from './notification-outbox-claim.service';
import { NotificationProviderAdapter } from './notification-provider-adapter';
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
    private readonly payloadResolver: NotificationDeliveryPayloadResolverService,
    private readonly attemptService: NotificationDeliveryAttemptService,
    private readonly submissionBoundaryService: NotificationSubmissionBoundaryService,
    private readonly providerContractService: NotificationProviderContractService,
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

    const { recipient, messageBody } = this.payloadResolver.resolve(claimed);

    let result: ProviderAttemptResult;
    try {
      const providerResult = await adapter.submit({
        notificationOutboxId: claimed.id,
        notificationType: claimed.notificationType,
        channel: claimed.channel,
        providerIdempotencyKey: claimed.providerIdempotencyKey,
        recipient,
        messageBody,
      });
      this.providerContractService.assertSubmissionResult(
        adapter,
        providerResult,
        [recipient, messageBody],
      );
      result = providerResult;
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
