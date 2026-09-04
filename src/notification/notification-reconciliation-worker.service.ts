import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationProviderAdapter,
  NotificationProviderReconciliationOutcome,
  NotificationProviderReconciliationResult,
} from './notification-provider-adapter';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationOutboxReconciliationService } from './notification-outbox-reconciliation.service';

@Injectable()
export class NotificationReconciliationWorkerService {
  constructor(
    private readonly reconciliation: NotificationOutboxReconciliationService,
    private readonly providerContract: NotificationProviderContractService,
  ) {}

  async reconcileNext(
    workerId: string,
    leaseDurationMs: number,
    adapter: NotificationProviderAdapter,
    now = new Date(),
  ) {
    const candidate = await this.reconciliation.claimExpiredForReconciliation(
      workerId,
      leaseDurationMs,
      now,
    );

    if (!candidate) return null;

    this.providerContract.assertAdapter(adapter, candidate.channel);
    if (!adapter.supportsStatusLookup) {
      throw new BadRequestException(
        'Notification provider does not support reconciliation status lookup.',
      );
    }

    let result: NotificationProviderReconciliationResult;
    try {
      result = await adapter.reconcile({
        notificationOutboxId: candidate.id,
        providerIdempotencyKey: candidate.providerIdempotencyKey,
        providerName: candidate.providerName,
        providerReference: candidate.providerReference,
        providerStatus: candidate.providerStatus,
      });
    } catch {
      result = {
        outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN,
      };
    }

    return this.reconciliation.applyReconciliation(
      candidate.id,
      candidate.processingWorkerId,
      result,
      now,
    );
  }
}
