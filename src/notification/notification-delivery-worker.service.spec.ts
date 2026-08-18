import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationProviderAdapter } from './notification-provider-adapter';

describe('NotificationDeliveryWorkerService', () => {
  const now = new Date('2026-08-18T14:00:00.000Z');
  const claimed = {
    id: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    recipientMobileEncrypted: 'enc-mobile',
    recipientEmailEncrypted: null,
    messageBodyEncrypted: 'enc-message',
    providerIdempotencyKey: 'provider-key-1',
    attemptCount: 0,
    processingStartedAt: new Date('2026-08-18T13:59:00.000Z'),
    leaseExpiresAt: new Date('2026-08-18T14:05:00.000Z'),
    processingWorkerId: 'worker-1',
  };

  function createService() {
    const mobileNumberService = {
      decrypt: jest.fn(() => '+639171234567'),
    };
    const payloadService = {
      decryptMessage: jest.fn(() => 'Your verification code is 123456.'),
    };
    const attemptService = {
      finalizeAttempt: jest.fn(() =>
        Promise.resolve({
          notificationLogId: 'log-1',
          attemptNumber: 1,
          outboxStatus: NotificationOutboxStatus.SENT,
        }),
      ),
    };

    return {
      service: new NotificationDeliveryWorkerService(
        mobileNumberService as never,
        payloadService as never,
        attemptService as never,
      ),
      mobileNumberService,
      payloadService,
      attemptService,
    };
  }

  function createAdapter(
    submit: NotificationProviderAdapter['submit'],
  ): NotificationProviderAdapter {
    return {
      providerName: 'provider-a',
      channel: NotificationChannel.SMS,
      supportsIdempotency: true,
      supportsStatusLookup: true,
      submit,
      reconcile: jest.fn(),
    };
  }

  it('decrypts protected SMS payload only for the provider adapter and finalizes success', async () => {
    const fixture = createService();
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() =>
      Promise.resolve({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: 'provider-message-1',
        providerStatus: 'accepted',
        submittedAt: now,
        resolvedAt: now,
      }),
    );
    const adapter = createAdapter(submit);

    const result = await fixture.service.deliverClaimed(claimed, adapter, now);

    expect(fixture.mobileNumberService.decrypt).toHaveBeenCalledWith(
      'enc-mobile',
    );
    expect(fixture.payloadService.decryptMessage).toHaveBeenCalledWith(
      'enc-message',
    );
    expect(submit).toHaveBeenCalledWith({
      notificationOutboxId: claimed.id,
      notificationType: NotificationType.OTP_VERIFICATION,
      channel: NotificationChannel.SMS,
      providerIdempotencyKey: claimed.providerIdempotencyKey,
      recipient: '+639171234567',
      messageBody: 'Your verification code is 123456.',
    });
    expect(fixture.attemptService.finalizeAttempt).toHaveBeenCalledWith(
      claimed.id,
      claimed.processingWorkerId,
      expect.objectContaining({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerReference: 'provider-message-1',
      }),
      now,
    );
    expect(result.outboxStatus).toBe(NotificationOutboxStatus.SENT);
  });

  it('records a thrown provider submission as uncertain rather than retrying', async () => {
    const fixture = createService();
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() => Promise.reject(new Error('provider timeout')));
    const adapter = createAdapter(submit);

    await fixture.service.deliverClaimed(claimed, adapter, now);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(fixture.attemptService.finalizeAttempt).toHaveBeenCalledTimes(1);
    expect(fixture.attemptService.finalizeAttempt).toHaveBeenCalledWith(
      claimed.id,
      claimed.processingWorkerId,
      {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: 'provider-a',
        providerStatus: 'submission-result-unavailable',
        failureDetailSanitized:
          'Provider submission result was unavailable after the delivery attempt.',
        submittedAt: now,
        resolvedAt: null,
      },
      now,
    );
  });

  it('rejects an adapter whose channel does not match the claimed outbox', async () => {
    const fixture = createService();
    const adapter: NotificationProviderAdapter = {
      providerName: 'email-provider',
      channel: NotificationChannel.EMAIL,
      supportsIdempotency: true,
      supportsStatusLookup: true,
      submit: jest.fn(),
      reconcile: jest.fn(),
    };

    await expect(
      fixture.service.deliverClaimed(claimed, adapter, now),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.mobileNumberService.decrypt).not.toHaveBeenCalled();
    expect(fixture.payloadService.decryptMessage).not.toHaveBeenCalled();
    expect(fixture.attemptService.finalizeAttempt).not.toHaveBeenCalled();
  });
});
