import { BadRequestException } from '@nestjs/common';
import { NotificationChannel } from '../../generated/prisma/client';
import {
  NotificationProviderAdapter,
  NotificationProviderReconciliationOutcome,
} from './notification-provider-adapter';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationReconciliationWorkerService } from './notification-reconciliation-worker.service';

describe('NotificationReconciliationWorkerService', () => {
  const now = new Date('2026-08-22T01:00:00.000Z');
  const candidate = {
    id: 'outbox-1',
    notificationType: 'PASSWORD_RESET' as never,
    channel: NotificationChannel.EMAIL,
    providerIdempotencyKey: 'provider-key-1',
    providerName: 'provider-a',
    providerReference: 'message-1',
    providerStatus: 'unknown',
    latestAttemptNumber: 1,
    processingStartedAt: new Date('2026-08-22T00:55:00.000Z'),
    leaseExpiresAt: new Date('2026-08-22T01:05:00.000Z'),
    processingWorkerId: 'reconcile-worker',
  };

  function createFixture() {
    const reconciliation = {
      claimExpiredForReconciliation: jest.fn<
        Promise<typeof candidate | null>,
        [string, number, Date]
      >(() => Promise.resolve(candidate)),
      applyReconciliation: jest.fn(() =>
        Promise.resolve({ outboxStatus: 'SENT' }),
      ),
    };
    const service = new NotificationReconciliationWorkerService(
      reconciliation as never,
      new NotificationProviderContractService(),
    );
    return { service, reconciliation };
  }

  function adapter(
    reconcile: NotificationProviderAdapter['reconcile'],
    supportsStatusLookup = true,
  ): NotificationProviderAdapter {
    return {
      providerName: 'provider-a',
      channel: NotificationChannel.EMAIL,
      supportsIdempotency: true,
      supportsStatusLookup,
      submit: jest.fn(),
      reconcile,
    };
  }

  it('returns null when there is no expired processing lease to reconcile', async () => {
    const fixture = createFixture();
    fixture.reconciliation.claimExpiredForReconciliation.mockResolvedValue(null);
    const reconcile = jest.fn();

    await expect(
      fixture.service.reconcileNext(
        'reconcile-worker',
        30_000,
        adapter(reconcile),
        now,
      ),
    ).resolves.toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('looks up provider status and applies confirmed success', async () => {
    const fixture = createFixture();
    const reconcile = jest.fn(() =>
      Promise.resolve({
        outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
        providerConfirmedAt: now,
      }),
    );

    await fixture.service.reconcileNext(
      'reconcile-worker',
      30_000,
      adapter(reconcile),
      now,
    );

    expect(reconcile).toHaveBeenCalledWith({
      notificationOutboxId: candidate.id,
      providerIdempotencyKey: candidate.providerIdempotencyKey,
      providerName: candidate.providerName,
      providerReference: candidate.providerReference,
      providerStatus: candidate.providerStatus,
    });
    expect(fixture.reconciliation.applyReconciliation).toHaveBeenCalledWith(
      candidate.id,
      candidate.processingWorkerId,
      {
        outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
        providerConfirmedAt: now,
      },
      now,
    );
  });

  it('keeps the outbox uncertain when provider lookup throws', async () => {
    const fixture = createFixture();
    const reconcile = jest.fn(() => Promise.reject(new Error('timeout')));

    await fixture.service.reconcileNext(
      'reconcile-worker',
      30_000,
      adapter(reconcile),
      now,
    );

    expect(fixture.reconciliation.applyReconciliation).toHaveBeenCalledWith(
      candidate.id,
      candidate.processingWorkerId,
      { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN },
      now,
    );
  });

  it('rejects provider adapters that cannot perform status lookup', async () => {
    const fixture = createFixture();
    const reconcile = jest.fn();

    await expect(
      fixture.service.reconcileNext(
        'reconcile-worker',
        30_000,
        adapter(reconcile, false),
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
