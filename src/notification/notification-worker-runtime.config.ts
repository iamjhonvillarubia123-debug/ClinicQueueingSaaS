import { ConfigService } from '@nestjs/config';

export type NotificationWorkerRuntimeConfig = {
  leaseDurationMs: number;
  deliveryPollMs: number;
  reconciliationPollMs: number;
};

function readInteger(
  config: ConfigService,
  key: string,
  fallback: number | null,
  min: number,
  max: number,
): number {
  const raw = config.get<string | number | undefined>(key);
  const resolved = raw ?? fallback;

  if (resolved === null || resolved === undefined || resolved === '') {
    throw new Error(`Notification worker requires ${key}.`);
  }

  const value = Number(resolved);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Notification worker ${key} must be an integer between ${min} and ${max} milliseconds.`,
    );
  }

  return value;
}

export function loadNotificationWorkerRuntimeConfig(
  config: ConfigService,
): NotificationWorkerRuntimeConfig {
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const providerTimeoutMs = Number(
    config.get<string | number>('PHILSMS_TIMEOUT_MS', 10000),
  );

  const leaseDurationMs = readInteger(
    config,
    'NOTIFICATION_WORKER_LEASE_MS',
    isProduction ? null : 60000,
    5000,
    300000,
  );
  if (
    Number.isFinite(providerTimeoutMs) &&
    leaseDurationMs <= providerTimeoutMs + 5000
  ) {
    throw new Error(
      'Notification worker lease must exceed the provider timeout by more than 5000 milliseconds.',
    );
  }

  return {
    leaseDurationMs,
    deliveryPollMs: readInteger(
      config,
      'NOTIFICATION_WORKER_POLL_MS',
      1000,
      100,
      60000,
    ),
    reconciliationPollMs: readInteger(
      config,
      'NOTIFICATION_RECONCILIATION_POLL_MS',
      5000,
      500,
      60000,
    ),
  };
}
