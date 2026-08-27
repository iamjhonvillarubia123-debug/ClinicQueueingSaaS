import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Distributed rate limiting (e2e)', () => {
  let app: INestApplication<App> | undefined;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm13-rate-limit-e2e-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 141).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 142).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm13-rate-limit-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm13-rate-limit-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 143).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm13-rate-limit-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
    RATE_LIMIT_ENABLED: 'true',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const isolatedConfig = new ConfigService<Record<string, string>>({
      ...testEnvironment,
      DATABASE_URL: process.env.DATABASE_URL ?? '',
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(isolatedConfig)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects the eleventh matching login request within the 15-minute window', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const email = `rate-${randomUUID()}@example.test`;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'not-a-real-password' });

      expect(response.status).not.toBe(429);
    }

    const limited = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'not-a-real-password' })
      .expect(429);
    const body = limited.body as unknown as {
      statusCode: number;
      code: string;
      message: string;
      requestId: string;
    };

    expect(limited.headers['retry-after']).toEqual(expect.any(String));
    expect(body.statusCode).toBe(429);
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.message).toBe('Too many requests. Please try again later.');
    expect(body.requestId).toEqual(expect.any(String));
  });
});
