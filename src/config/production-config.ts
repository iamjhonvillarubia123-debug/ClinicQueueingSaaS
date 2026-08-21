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

function validateSmsProvider(config: Record<string, unknown>): void {
  const provider = requireProductionValue(config, 'SMS_PROVIDER').toUpperCase();
  if (provider !== 'PHILSMS') {
    throw new Error('Production configuration SMS_PROVIDER is unsupported.');
  }

  requireProductionValue(config, 'PHILSMS_API_TOKEN');
  requireProductionValue(config, 'PHILSMS_SENDER_ID');

  const configuredTimeout = config.PHILSMS_TIMEOUT_MS;
  const timeoutRaw =
    configuredTimeout === undefined ? '10000' : configuredTimeout;
  if (typeof timeoutRaw !== 'string' && typeof timeoutRaw !== 'number') {
    throw new Error(
      'Production configuration PHILSMS_TIMEOUT_MS must be between 1000 and 30000 milliseconds.',
    );
  }
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error(
      'Production configuration PHILSMS_TIMEOUT_MS must be between 1000 and 30000 milliseconds.',
    );
  }

  if (config.PHILSMS_BASE_URL !== undefined) {
    const baseUrl = requireProductionValue(config, 'PHILSMS_BASE_URL');
    requireHttpsUrl(baseUrl, 'PHILSMS_BASE_URL');
  }
}

export function validateRuntimeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV !== 'production') return config;

  for (const key of REQUIRED_PRODUCTION_ENV) {
    requireProductionValue(config, key);
  }

  requireHttpsUrl(String(config.PUBLIC_APP_BASE_URL), 'PUBLIC_APP_BASE_URL');
  requireHttpsUrl(String(config.WEB_APP_ORIGIN), 'WEB_APP_ORIGIN');
  validateSmsProvider(config);

  return config;
}
