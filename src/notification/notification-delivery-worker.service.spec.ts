import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationProviderAdapter } from './notification-provider-adapter';
import { NotificationProviderContractService } from './notification-provider-contract.service';
import { NotificationSubmissionBoundaryResult } from './notification-submission-boundary.service';

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
      finalizeReservedAttempt: jest.fn(() =>
        Promise.resolve({
          notificationLogId: 'log-1',
          attemptNumber: 1,
          outboxStatus: NotificationOutboxStatus.SENT,
        }),
      ),
    };
    const submissionBoundaryService = {
      reserveAttempt: jest.fn<
        Promise<NotificationSubmissionBoundaryResult>,
        [string, string, Date]
      >(() => Promise.resolve({ disposition: 'RESERVED', attemptNumber: 1 })),
    };
    const providerContractService = new NotificationProviderContractService();

    return {
      service: new NotificationDeliveryWorkerService(
        mobileNumberService as never,
        payloadService as never,
        attemptService as never,
        submissionBoundaryService as never,
        providerContractService,
      ),
      mobileNumberService,
      payloadService,
      attemptService,
      submissionBoundaryService,
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

  it('reserves an attempt before decrypting protected payload and provider submission', async () => {
    const fixture = createService();
    const callOrder: string[] = [];
    fixture.submissionBoundaryService.reserveAttempt.mockImplementation(() => {
      callOrder.push('reserve');
      return Promise.resolve({ disposition: 'RESERVED', attemptNumber: 1 });
    });
    fixture.mobileNumberService.decrypt.mockImplementation(() => {
      callOrder.push('decrypt-mobile');
      return '+639171234567';
    });
    fixture.payloadService.decryptMessage.mockImplementation(() => {
      callOrder.push('decrypt-message');
      return 'Your verification code is 123456.';
    });
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() => {
      callOrder.push('submit');
      return Promise.resolve({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: 'provider-message-1',
        providerStatus: 'accepted',
        submittedAt: now,
        resolvedAt: now,
      });
    });
    const adapter = createAdapter(submit);

    const result = await fixture.service.deliverClaimed(claimed, adapter, now);

    expect(
      fixture.submissionBoundaryService.reserveAttempt,
    ).toHaveBeenCalledWith(claimed.id, claimed.processingWorkerId, now);
    expect(fixture.mobileNumberService.decrypt).toHaveBeenCalledWith(
      'enc-mobile',
    );
    expect(fixture.payloadService.decryptMessage).toHaveBeenCalledWith(
      'enc-message',
    );
    expect(callOrder).toEqual([
      'reserve',
      'decrypt-mobile',
      'decrypt-message',
      'submit',
    ]);
    expect(submit).toHaveBeenCalledWith({
      notificationOutboxId: claimed.id,
      notificationType: NotificationType.OTP_VERIFICATION,
      channel: NotificationChannel.SMS,
      providerIdempotencyKey: claimed.providerIdempotencyKey,
      recipient: '+639171234567',
      messageBody: 'Your verification code is 123456.',
    });
    expect(fixture.attemptService.finalizeReservedAttempt).toHaveBeenCalledWith(
      claimed.id,
      claimed.processingWorkerId,
      1,
      expect.objectContaining({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerReference: 'provider-message-1',
      }),
      now,
    );
    expect(result.outboxStatus).toBe(NotificationOutboxStatus.SENT);
  });

  it('returns cancelled without decrypting or calling the provider when the boundary rejects a stale OTP', async () => {
    const fixture = createService();
    fixture.submissionBoundaryService.reserveAttempt.mockResolvedValue({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >();
    const adapter = createAdapter(submit);

    await expect(
      fixture.service.deliverClaimed(claimed, adapter, now),
    ).resolves.toEqual({
      notificationLogId: null,
      attemptNumber: null,
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });

    expect(fixture.mobileNumberService.decrypt).not.toHaveBeenCalled();
    expect(fixture.payloadService.decryptMessage).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(
      fixture.attemptService.finalizeReservedAttempt,
    ).not.toHaveBeenCalled();
  });

  it('records a thrown provider submission as uncertain on the reserved attempt rather than retrying', async () => {
    const fixture = createService();
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() => Promise.reject(new Error('provider timeout')));
    const adapter = createAdapter(submit);

    await fixture.service.deliverClaimed(claimed, adapter, now);

    expect(
      fixture.submissionBoundaryService.reserveAttempt,
    ).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      fixture.attemptService.finalizeReservedAttempt,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.attemptService.finalizeReservedAttempt).toHaveBeenCalledWith(
      claimed.id,
      claimed.processingWorkerId,
      1,
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

  it('rejects invalid provider output instead of disguising a contract violation as delivery uncertainty', async () => {
    const fixture = createService();
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >(() =>
      Promise.resolve({
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'different-provider',
        providerStatus: 'accepted',
        submittedAt: now,
        resolvedAt: now,
      }),
    );

    await expect(
      fixture.service.deliverClaimed(claimed, createAdapter(submit), now),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      fixture.attemptService.finalizeReservedAttempt,
    ).not.toHaveBeenCalled();
  });

  it('does not call the provider when attempt reservation fails', async () => {
    const fixture = createService();
    fixture.submissionBoundaryService.reserveAttempt.mockRejectedValue(
      new BadRequestException('cancelled before submission'),
    );
    const submit = jest.fn<
      ReturnType<NotificationProviderAdapter['submit']>,
      Parameters<NotificationProviderAdapter['submit']>
    >();
    const adapter = createAdapter(submit);

    await expect(
      fixture.service.deliverClaimed(claimed, adapter, now),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(submit).not.toHaveBeenCalled();
    expect(
      fixture.attemptService.finalizeReservedAttempt,
    ).not.toHaveBeenCalled();
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
    expect(
      fixture.submissionBoundaryService.reserveAttempt,
    ).not.toHaveBeenCalled();
    expect(
      fixture.attemptService.finalizeReservedAttempt,
    ).not.toHaveBeenCalled();
  });
});
