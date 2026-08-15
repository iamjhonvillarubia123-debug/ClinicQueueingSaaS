import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App> | undefined;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm1s1-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 3).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
  };

  const originalEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/app/health (GET)', async () => {
    if (!app) {
      throw new Error('E2E application did not initialize.');
    }

    const response: Response = await request(app.getHttpServer())
      .get('/app/health')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'OK',
        message: 'Clinic Queueing SaaS API is running',
        userCount: expect.any(Number) as unknown,
      }),
    );
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }

    for (const key of Object.keys(testEnvironment)) {
      const originalValue = originalEnvironment[key];

      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });
});
