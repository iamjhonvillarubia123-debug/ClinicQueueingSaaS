const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'MOBILE_ENCRYPTION_KEY_V1',
  'MOBILE_LOOKUP_HMAC_KEY_V1',
  'MOBILE_ENCRYPTION_ACTIVE_KEY_ID',
  'MOBILE_LOOKUP_ACTIVE_KEY_ID',
  'OTP_HMAC_KEY_V1',
  'OTP_HMAC_ACTIVE_KEY_ID',
  'PUBLIC_APP_BASE_URL',
  'WEB_APP_ORIGIN',
  'NOTIFICATION_WORKER_LEASE_MS',
] as const;

const PLACEHOLDER_MARKERS = [
  'CHANGE_ME',
  'REPLACE_WITH',
  'YOUR_PASSWORD',
  'YOUR_DB_USER',
];

function requireProductionValue(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Production configuration requires ${key}.`);
  }

  const trimmed = value.trim();
  if (PLACEHOLDER_MARKERS.some((marker) => trimmed.includes(marker))) {
    throw new Error(`Production configuration for ${key} is a placeholder.`);
  }

  return trimmed;
}

function requireHttpsUrl(value: string, key: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Production configuration ${key} must be a valid URL.`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Production configuration ${key} must use HTTPS.`);
  }
}

function requirePostgresUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Production configuration DATABASE_URL must be a valid URL.');
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error(
      'Production configuration DATABASE_URL must use PostgreSQL.',
    );
  }
}

function readInteger(
  config: Record<string, unknown>,
  key: string,
  fallback: number | null,
  min: number,
  max: number,
): number {
  const raw = config[key] ?? fallback;
  if (raw === null || raw === undefined || raw === '') {
    throw new Error(`Production configuration requires ${key}.`);
  }

  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new Error(
      `Production configuration ${key} must be between ${min} and ${max} milliseconds.`,
    );
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Production configuration ${key} must be between ${min} and ${max} milliseconds.`,
    );
  }

  return value;
}

function validateSmsProvider(config: Record<string, unknown>): number {
  const provider = requireProductionValue(config, 'SMS_PROVIDER').toUpperCase();
  if (provider !== 'PHILSMS') {
    throw new Error('Production configuration SMS_PROVIDER is unsupported.');
  }

  requireProductionValue(config, 'PHILSMS_API_TOKEN');
  requireProductionValue(config, 'PHILSMS_SENDER_ID');

  const timeoutMs = readInteger(
    config,
    'PHILSMS_TIMEOUT_MS',
    10000,
    1000,
    30000,
  );

  if (config.PHILSMS_BASE_URL !== undefined) {
    const baseUrl = requireProductionValue(config, 'PHILSMS_BASE_URL');
    requireHttpsUrl(baseUrl, 'PHILSMS_BASE_URL');
  }

  return timeoutMs;
}

function validateWorkerConfiguration(
  config: Record<string, unknown>,
  providerTimeoutMs: number,
): void {
  const leaseDurationMs = readInteger(
    config,
    'NOTIFICATION_WORKER_LEASE_MS',
    null,
    5000,
    300000,
  );
  if (leaseDurationMs <= providerTimeoutMs + 5000) {
    throw new Error(
      'Production configuration NOTIFICATION_WORKER_LEASE_MS must exceed PHILSMS_TIMEOUT_MS by more than 5000 milliseconds.',
    );
  }

  if (config.NOTIFICATION_WORKER_POLL_MS !== undefined) {
    readInteger(config, 'NOTIFICATION_WORKER_POLL_MS', null, 100, 60000);
  }
  if (config.NOTIFICATION_RECONCILIATION_POLL_MS !== undefined) {
    readInteger(
      config,
      'NOTIFICATION_RECONCILIATION_POLL_MS',
      null,
      500,
      60000,
    );
  }
  if (config.MAINTENANCE_WORKER_INTERVAL_MS !== undefined) {
    readInteger(
      config,
      'MAINTENANCE_WORKER_INTERVAL_MS',
      null,
      10000,
      3600000,
    );
  }
}

export function validateRuntimeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV !== 'production') return config;

  for (const key of REQUIRED_PRODUCTION_ENV) {
    requireProductionValue(config, key);
  }

  requirePostgresUrl(String(config.DATABASE_URL));
  requireHttpsUrl(String(config.PUBLIC_APP_BASE_URL), 'PUBLIC_APP_BASE_URL');
  requireHttpsUrl(String(config.WEB_APP_ORIGIN), 'WEB_APP_ORIGIN');

  if (String(config.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() === 'false') {
    throw new Error('Production configuration cannot disable rate limiting.');
  }

  const providerTimeoutMs = validateSmsProvider(config);
  validateWorkerConfiguration(config, providerTimeoutMs);

  return config;
}
