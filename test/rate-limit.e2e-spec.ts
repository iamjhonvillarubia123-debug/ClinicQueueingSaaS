import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Distributed rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await app.close();
  });

  it('rejects the eleventh matching login request within the 15-minute window', async () => {
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
