import { BadRequestException } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationProviderAdapter } from './notification-provider-adapter';
import { NotificationProviderContractService } from './notification-provider-contract.service';

describe('NotificationProviderContractService', () => {
  const service = new NotificationProviderContractService();
  const now = new Date('2026-08-19T10:00:00.000Z');

  function adapter(
    overrides: Partial<NotificationProviderAdapter> = {},
  ): NotificationProviderAdapter {
    return {
      providerName: 'provider-a',
      channel: NotificationChannel.SMS,
      supportsIdempotency: true,
      supportsStatusLookup: true,
      submit: jest.fn(),
      reconcile: jest.fn(),
      ...overrides,
    };
  }

  it('accepts a normalized adapter and bounded success result', () => {
    const current = adapter();
    expect(() =>
      service.assertAdapter(current, NotificationChannel.SMS),
    ).not.toThrow();
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        providerReference: 'message-123',
        providerStatus: 'accepted',
        submittedAt: now,
        resolvedAt: now,
      }),
    ).not.toThrow();
  });

  it('rejects wrong-channel and non-normalized provider adapters', () => {
    expect(() =>
      service.assertAdapter(
        adapter({ channel: NotificationChannel.EMAIL }),
        NotificationChannel.SMS,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertAdapter(
        adapter({ providerName: ' provider-a ' }),
        NotificationChannel.SMS,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a provider result whose provider identity changes after submission', () => {
    const current = adapter();
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-b',
        submittedAt: now,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unsafe or oversized provider metadata', () => {
    const current = adapter();
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
        providerName: 'provider-a',
        providerStatus: 'bad\nraw-response',
        submittedAt: now,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
        providerName: 'provider-a',
        failureDetailSanitized: 'x'.repeat(501),
        submittedAt: now,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects recipient, OTP, secure URL, and long-token leakage in provider metadata', () => {
    const current = adapter();
    const recipient = '+639171234567';
    const messageBody =
      'Your verification code is 123456. Continue at https://app.example.test/verify?token=abcdefghijklmnopQRSTUVWX.';

    for (const failureDetailSanitized of [
      `Recipient ${recipient} rejected`,
      'OTP 123456 rejected',
      'Failed URL https://app.example.test/verify?token=abcdefghijklmnopQRSTUVWX.',
      'Credential abcdefghijklmnopQRSTUVWX invalid',
    ]) {
      expect(() =>
        service.assertSubmissionResult(
          current,
          {
            outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
            providerName: 'provider-a',
            failureDetailSanitized,
            submittedAt: now,
            resolvedAt: now,
          },
          [recipient, messageBody],
        ),
      ).toThrow(BadRequestException);
    }
  });

  it('rejects contradictory retry and uncertain timing metadata', () => {
    const current = adapter();
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: 'provider-a',
        submittedAt: now,
        resolvedAt: now,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertSubmissionResult(current, {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: 'provider-a',
        submittedAt: now,
        nextAttemptAt: new Date(now.getTime() + 60_000),
      }),
    ).toThrow(BadRequestException);
  });

  it('does not inspect protected delivery content as part of adapter validation', () => {
    const current = adapter();
    const request = {
      notificationOutboxId: 'outbox-1',
      notificationType: NotificationType.OTP_VERIFICATION,
      channel: NotificationChannel.SMS,
      providerIdempotencyKey: 'stable-key',
      recipient: '+639171234567',
      messageBody: '123456',
    };
    expect(request.recipient).toBeDefined();
    expect(() =>
      service.assertAdapter(current, NotificationChannel.SMS),
    ).not.toThrow();
  });
});
