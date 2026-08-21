import { ConfigService } from '@nestjs/config';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/client';
import {
  NotificationProviderReconciliationOutcome,
  NotificationProviderSubmissionRequest,
} from './notification-provider-adapter';
import { PhilSmsNotificationProviderAdapter } from './philsms-notification-provider.adapter';

describe('PhilSmsNotificationProviderAdapter', () => {
  const originalFetch = global.fetch;
  const request: NotificationProviderSubmissionRequest = {
    notificationOutboxId: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    providerIdempotencyKey: 'provider-key-1',
    recipient: '+639171234567',
    messageBody: 'Your verification code is 123456.',
  };

  function createAdapter() {
    const values: Record<string, string> = {
      PHILSMS_API_TOKEN: 'test-token',
      PHILSMS_SENDER_ID: 'ClinicQueue',
      PHILSMS_BASE_URL: 'https://app.philsms.com/api/v3',
      PHILSMS_TIMEOUT_MS: '10000',
    };
    const config = {
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    };
    return new PhilSmsNotificationProviderAdapter(
      config as unknown as ConfigService,
    );
  }

  function response(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn(() => Promise.resolve(body)),
    } as unknown as Response;
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('captures PhilSMS UID and accepted status on successful submission', async () => {
    const fetchMock = jest.fn<
      Promise<Response>,
      [RequestInfo | URL, RequestInit?]
    >(() =>
      Promise.resolve(
        response(200, {
          status: 'success',
          data: { uid: 'sms-uid-1', status: 'queued' },
        }),
      ),
    );
    global.fetch = fetchMock;

    const result = await createAdapter().submit(request);

    expect(result.outcome).toBe(NotificationAttemptOutcome.SUCCESS);
    expect(result.providerName).toBe('PhilSMS');
    expect(result.providerReference).toBe('sms-uid-1');
    expect(result.providerStatus).toBe('queued');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.philsms.com/api/v3/sms/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('treats successful submission without a provider UID as uncertain', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        response(200, { status: 'success', data: { status: 'queued' } }),
      ),
    );

    await expect(createAdapter().submit(request)).resolves.toEqual(
      expect.objectContaining({
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: 'PhilSMS',
        providerStatus: 'accepted_without_uid',
      }),
    );
  });

  it('marks HTTP 429 as retryable with a future retry time', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(response(429, { status: 'error' })),
    );

    const result = await createAdapter().submit(request);

    expect(result.outcome).toBe(NotificationAttemptOutcome.RETRYABLE_FAILURE);
    expect(result.providerErrorCode).toBe('HTTP_429');
    expect(result.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('marks non-retryable HTTP 4xx rejection as permanent failure', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(response(422, { status: 'error' })),
    );

    const result = await createAdapter().submit(request);

    expect(result.outcome).toBe(NotificationAttemptOutcome.PERMANENT_FAILURE);
    expect(result.providerErrorCode).toBe('HTTP_422');
    expect(result.nextAttemptAt).toBeNull();
  });

  it('treats network failure as uncertain rather than retrying blindly', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network timeout')));

    await expect(createAdapter().submit(request)).resolves.toEqual(
      expect.objectContaining({
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerStatus: 'transport_uncertain',
      }),
    );
  });

  it('maps delivered status lookup to confirmed success', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        response(200, {
          status: 'success',
          data: { uid: 'sms-uid-1', status: 'delivered' },
        }),
      ),
    );

    await expect(
      createAdapter().reconcile({
        notificationOutboxId: 'outbox-1',
        providerIdempotencyKey: 'provider-key-1',
        providerName: 'PhilSMS',
        providerReference: 'sms-uid-1',
        providerStatus: 'queued',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
      }),
    );
  });

  it('maps terminal failed status lookup to confirmed permanent failure', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        response(200, {
          status: 'success',
          data: { uid: 'sms-uid-1', status: 'failed' },
        }),
      ),
    );

    await expect(
      createAdapter().reconcile({
        notificationOutboxId: 'outbox-1',
        providerIdempotencyKey: 'provider-key-1',
        providerReference: 'sms-uid-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome:
          NotificationProviderReconciliationOutcome.CONFIRMED_PERMANENT_FAILURE,
      }),
    );
  });

  it('keeps nonterminal or unavailable status lookup uncertain', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        response(200, {
          status: 'success',
          data: { uid: 'sms-uid-1', status: 'processing' },
        }),
      ),
    );

    await expect(
      createAdapter().reconcile({
        notificationOutboxId: 'outbox-1',
        providerIdempotencyKey: 'provider-key-1',
        providerReference: 'sms-uid-1',
      }),
    ).resolves.toEqual({
      outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN,
    });
  });
});
