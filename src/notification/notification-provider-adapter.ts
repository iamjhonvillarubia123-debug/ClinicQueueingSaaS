import {
  NotificationAttemptOutcome,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/client';

export type NotificationProviderSubmissionRequest = {
  notificationOutboxId: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  providerIdempotencyKey: string;
  recipientEncrypted: string;
  messageBodyEncrypted: string;
};

export type NotificationProviderSubmissionResult = {
  outcome: NotificationAttemptOutcome;
  providerName: string;
  providerReference?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  failureDetailSanitized?: string | null;
  submittedAt: Date;
  resolvedAt?: Date | null;
  nextAttemptAt?: Date | null;
};

export enum NotificationProviderReconciliationOutcome {
  CONFIRMED_SUCCESS = 'CONFIRMED_SUCCESS',
  RETRY_SAFE_NOT_ACCEPTED = 'RETRY_SAFE_NOT_ACCEPTED',
  CONFIRMED_PERMANENT_FAILURE = 'CONFIRMED_PERMANENT_FAILURE',
  STILL_UNCERTAIN = 'STILL_UNCERTAIN',
}

export type NotificationProviderReconciliationRequest = {
  notificationOutboxId: string;
  providerIdempotencyKey: string;
  providerName?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;
};

export type NotificationProviderReconciliationResult = {
  outcome: NotificationProviderReconciliationOutcome;
  providerConfirmedAt?: Date | null;
  nextAttemptAt?: Date | null;
};

export interface NotificationProviderAdapter {
  readonly providerName: string;
  readonly channel: NotificationChannel;
  readonly supportsIdempotency: boolean;
  readonly supportsStatusLookup: boolean;

  submit(
    request: NotificationProviderSubmissionRequest,
  ): Promise<NotificationProviderSubmissionResult>;

  reconcile(
    request: NotificationProviderReconciliationRequest,
  ): Promise<NotificationProviderReconciliationResult>;
}
