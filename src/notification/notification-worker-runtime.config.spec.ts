import { ConfigService } from '@nestjs/config';
import { loadNotificationWorkerRuntimeConfig } from './notification-worker-runtime.config';

describe('loadNotificationWorkerRuntimeConfig', () => {
  function config(values: Record<string, string | number>) {
    return new ConfigService(values);
  }

  it('uses bounded non-production defaults', () => {
    expect(
      loadNotificationWorkerRuntimeConfig(config({ NODE_ENV: 'test' })),
    ).toEqual({
      leaseDurationMs: 60000,
      deliveryPollMs: 1000,
      reconciliationPollMs: 5000,
    });
  });

  it('requires an explicit production lease duration', () => {
    expect(() =>
      loadNotificationWorkerRuntimeConfig(
        config({ NODE_ENV: 'production', PHILSMS_TIMEOUT_MS: 10000 }),
      ),
    ).toThrow('Notification worker requires NOTIFICATION_WORKER_LEASE_MS.');
  });

  it('requires the lease to safely exceed provider timeout', () => {
    expect(() =>
      loadNotificationWorkerRuntimeConfig(
        config({
          NODE_ENV: 'production',
          PHILSMS_TIMEOUT_MS: 30000,
          NOTIFICATION_WORKER_LEASE_MS: 35000,
        }),
      ),
    ).toThrow(
      'Notification worker lease must exceed the provider timeout by more than 5000 milliseconds.',
    );
  });

  it('accepts explicit bounded production worker timing', () => {
    expect(
      loadNotificationWorkerRuntimeConfig(
        config({
          NODE_ENV: 'production',
          PHILSMS_TIMEOUT_MS: 10000,
          NOTIFICATION_WORKER_LEASE_MS: 60000,
          NOTIFICATION_WORKER_POLL_MS: 1500,
          NOTIFICATION_RECONCILIATION_POLL_MS: 7000,
        }),
      ),
    ).toEqual({
      leaseDurationMs: 60000,
      deliveryPollMs: 1500,
      reconciliationPollMs: 7000,
    });
  });
});
