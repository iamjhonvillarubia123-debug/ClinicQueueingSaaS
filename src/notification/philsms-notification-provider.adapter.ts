import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
} from '../../generated/prisma/client';
import {
  NotificationProviderAdapter,
  NotificationProviderReconciliationOutcome,
  NotificationProviderReconciliationRequest,
  NotificationProviderReconciliationResult,
  NotificationProviderSubmissionRequest,
  NotificationProviderSubmissionResult,
} from './notification-provider-adapter';

type PhilSmsRecord = Record<string, unknown>;

@Injectable()
export class PhilSmsNotificationProviderAdapter
  implements NotificationProviderAdapter
{
  readonly providerName = 'PhilSMS';
  readonly channel = NotificationChannel.SMS;
  readonly supportsIdempotency = false;
  readonly supportsStatusLookup = true;

  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly senderId: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .get<string>('PHILSMS_BASE_URL', 'https://app.philsms.com/api/v3')
      .replace(/\/+$/u, '');
    this.apiToken = this.configService.get<string>('PHILSMS_API_TOKEN', '').trim();
    this.senderId = this.configService.get<string>('PHILSMS_SENDER_ID', '').trim();
    this.timeoutMs = Number(
      this.configService.get<string>('PHILSMS_TIMEOUT_MS', '10000'),
    );
  }

  async submit(
    request: NotificationProviderSubmissionRequest,
  ): Promise<NotificationProviderSubmissionResult> {
    const submittedAt = new Date();

    try {
      const response = await this.request('/sms/send', {
        method: 'POST',
        body: JSON.stringify({
          recipient: request.recipient,
          sender_id: this.senderId,
          type: 'plain',
          message: request.messageBody,
        }),
      });

      if (!response.ok) {
        return this.httpFailure(response.status, submittedAt);
      }

      const payload = await this.readJson(response);
      if (payload.status !== 'success') {
        return this.providerFailure(payload, submittedAt);
      }

      const uid = this.findString(payload.data, ['uid', 'id']);
      if (!uid) {
        return {
          outcome: NotificationAttemptOutcome.UNCERTAIN,
          providerName: this.providerName,
          providerStatus: 'accepted_without_uid',
          submittedAt,
        };
      }

      return {
        outcome: NotificationAttemptOutcome.SUCCESS,
        providerName: this.providerName,
        providerReference: uid,
        providerStatus: this.findString(payload.data, ['status']) ?? 'accepted',
        submittedAt,
        resolvedAt: new Date(),
      };
    } catch {
      return {
        outcome: NotificationAttemptOutcome.UNCERTAIN,
        providerName: this.providerName,
        providerStatus: 'transport_uncertain',
        submittedAt,
      };
    }
  }

  async reconcile(
    request: NotificationProviderReconciliationRequest,
  ): Promise<NotificationProviderReconciliationResult> {
    if (!request.providerReference) {
      return { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN };
    }

    try {
      const response = await this.request(
        `/sms/${encodeURIComponent(request.providerReference)}`,
        { method: 'GET' },
      );

      if (!response.ok) {
        return { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN };
      }

      const payload = await this.readJson(response);
      if (payload.status !== 'success') {
        return { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN };
      }

      const status = (
        this.findString(payload.data, ['status', 'delivery_status']) ?? ''
      ).toLowerCase();

      if (['delivered', 'sent', 'success', 'completed'].includes(status)) {
        return {
          outcome: NotificationProviderReconciliationOutcome.CONFIRMED_SUCCESS,
          providerConfirmedAt: new Date(),
        };
      }

      if (['failed', 'rejected', 'undelivered', 'expired'].includes(status)) {
        return {
          outcome:
            NotificationProviderReconciliationOutcome.CONFIRMED_PERMANENT_FAILURE,
          providerConfirmedAt: new Date(),
        };
      }

      return { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN };
    } catch {
      return { outcome: NotificationProviderReconciliationOutcome.STILL_UNCERTAIN };
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!this.apiToken || !this.senderId) {
      throw new Error('PhilSMS provider is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readJson(response: Response): Promise<PhilSmsRecord> {
    const value: unknown = await response.json();
    return this.asRecord(value) ?? {};
  }

  private httpFailure(
    status: number,
    submittedAt: Date,
  ): NotificationProviderSubmissionResult {
    const retryable = status === 408 || status === 429 || status >= 500;
    return {
      outcome: retryable
        ? NotificationAttemptOutcome.RETRYABLE_FAILURE
        : NotificationAttemptOutcome.PERMANENT_FAILURE,
      providerName: this.providerName,
      providerStatus: `http_${status}`,
      providerErrorCode: `HTTP_${status}`,
      failureDetailSanitized: 'PhilSMS rejected the submission request.',
      submittedAt,
      resolvedAt: new Date(),
      nextAttemptAt: retryable ? new Date(Date.now() + 60_000) : null,
    };
  }

  private providerFailure(
    payload: PhilSmsRecord,
    submittedAt: Date,
  ): NotificationProviderSubmissionResult {
    return {
      outcome: NotificationAttemptOutcome.PERMANENT_FAILURE,
      providerName: this.providerName,
      providerStatus: 'provider_error',
      providerErrorCode: 'PHILSMS_REJECTED',
      failureDetailSanitized:
        typeof payload.message === 'string'
          ? payload.message.slice(0, 500)
          : 'PhilSMS rejected the submission request.',
      submittedAt,
      resolvedAt: new Date(),
    };
  }

  private findString(value: unknown, keys: readonly string[]): string | null {
    const record = this.asRecord(value);
    if (!record) return null;

    for (const key of keys) {
      if (typeof record[key] === 'string' && record[key].trim()) {
        return record[key].trim();
      }
    }

    for (const nested of Object.values(record)) {
      const found = this.findString(nested, keys);
      if (found) return found;
    }

    return null;
  }

  private asRecord(value: unknown): PhilSmsRecord | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as PhilSmsRecord;
  }
}
