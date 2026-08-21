import { validateRuntimeConfig } from './production-config';

const validProductionConfig = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.example.com:5432/clinic',
  JWT_SECRET: 'a-long-random-production-secret',
  MOBILE_ENCRYPTION_KEY_V1: 'base64-mobile-encryption-key',
  MOBILE_LOOKUP_HMAC_KEY_V1: 'base64-mobile-lookup-key',
  MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'v1',
  MOBILE_LOOKUP_ACTIVE_KEY_ID: 'v1',
  OTP_HMAC_KEY_V1: 'base64-otp-hmac-key',
  OTP_HMAC_ACTIVE_KEY_ID: 'v1',
  PUBLIC_APP_BASE_URL: 'https://app.example.com',
  WEB_APP_ORIGIN: 'https://app.example.com',
});

describe('validateRuntimeConfig', () => {
  it('does not impose production requirements in non-production environments', () => {
    const config = { NODE_ENV: 'test' };
    expect(validateRuntimeConfig(config)).toBe(config);
  });

  it('accepts a complete production configuration', () => {
    const config = validProductionConfig();
    expect(validateRuntimeConfig(config)).toBe(config);
  });

  it('rejects missing production security configuration', () => {
    const config = validProductionConfig();
    delete (config as Partial<typeof config>).WEB_APP_ORIGIN;
    expect(() => validateRuntimeConfig(config)).toThrow(
      'Production configuration requires WEB_APP_ORIGIN.',
    );
  });

  it('rejects placeholder production secrets', () => {
    const config = validProductionConfig();
    config.JWT_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_SECRET';
    expect(() => validateRuntimeConfig(config)).toThrow(
      'Production configuration for JWT_SECRET is a placeholder.',
    );
  });

  it('requires HTTPS for public production origins', () => {
    const config = validProductionConfig();
    config.WEB_APP_ORIGIN = 'http://app.example.com';
    expect(() => validateRuntimeConfig(config)).toThrow(
      'Production configuration WEB_APP_ORIGIN must use HTTPS.',
    );
  });
});
