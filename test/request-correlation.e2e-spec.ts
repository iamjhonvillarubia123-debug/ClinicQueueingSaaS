import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe('Request correlation controls (e2e)', () => {
  let app: INestApplication<App> | undefined;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm13-request-correlation-e2e-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 131).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 132).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm13-request-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm13-request-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 133).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm13-request-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('generates a server request id for successful requests', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const response = await request(app.getHttpServer())
      .get('/app/health')
      .set('X-Request-Id', 'client-controlled-value')
      .expect(200);

    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.stringMatching(REQUEST_ID_PATTERN));
    expect(requestId).not.toBe('client-controlled-value');
  });

  it('returns the same generated request id in error headers and body', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const response = await request(app.getHttpServer())
      .get('/route-that-does-not-exist')
      .expect(404);

    const requestId = response.headers['x-request-id'];
    const body = response.body as unknown as { requestId?: string };

    expect(requestId).toEqual(expect.stringMatching(REQUEST_ID_PATTERN));
    expect(body.requestId).toBe(requestId);
  });
});
