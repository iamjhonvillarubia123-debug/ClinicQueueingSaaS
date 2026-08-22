import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AddressInfo } from 'node:net';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

type LoadResult = {
  name: string;
  requests: number;
  concurrency: number;
  elapsedMs: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

async function runLoad(
  name: string,
  requests: number,
  concurrency: number,
  operation: () => Promise<void>,
): Promise<LoadResult> {
  const latencies: number[] = [];
  let nextIndex = 0;
  const startedAt = performance.now();

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= requests) return;

      const requestStartedAt = performance.now();
      await operation();
      latencies.push(performance.now() - requestStartedAt);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const elapsedMs = performance.now() - startedAt;
  const result = {
    name,
    requests,
    concurrency,
    elapsedMs,
    requestsPerSecond: (requests * 1000) / elapsedMs,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: Math.max(...latencies),
  };

  console.log(
    `${result.name}: ${result.requests} requests, concurrency=${result.concurrency}, ` +
      `${result.requestsPerSecond.toFixed(1)} req/s, p50=${result.p50Ms.toFixed(1)}ms, ` +
      `p95=${result.p95Ms.toFixed(1)}ms, max=${result.maxMs.toFixed(1)}ms`,
  );

  return result;
}

async function expectHttp200(baseUrl: string, path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`);
  if (response.status !== 200) {
    throw new Error(`Load request ${path} returned HTTP ${response.status}.`);
  }
  await response.arrayBuffer();
}

describe('M13 HTTP and PostgreSQL load smoke (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let locationPublicIdentifier: string;
  let baseUrl: string;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm13-load-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 2).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'e2e-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 3).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'e2e-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
    RATE_LIMIT_ENABLED: 'false',
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

    prisma = moduleFixture.get(PrismaService);
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address) {
      throw new Error('M13 load application did not bind a TCP listener.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const unique = randomUUID();
    const baseNow = Date.now();
    const doctor = await prisma.user.create({
      data: {
        email: `m13-load-${unique}@example.test`,
        firstName: 'Load',
        lastName: 'Doctor',
        mobileNumber: `09${unique.replaceAll('-', '').slice(0, 9)}`,
        passwordHash: 'not-used-by-load-test',
        role: 'DOCTOR',
        doctorProfile: {
          create: {
            professionalTitle: 'Dr.',
            specialization: 'Family Medicine',
            licenseNumber: `LOAD-${unique}`,
            profileDescription: 'M13 load fixture',
            isProfilePublic: true,
          },
        },
        doctorFinancialAccount: {
          create: {
            entitlement: {
              create: {
                paidThrough: new Date(baseNow + 24 * 60 * 60 * 1000),
                graceEndsAt: new Date(baseNow + 8 * 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      },
      include: { doctorProfile: true },
    });

    if (!doctor.doctorProfile) {
      throw new Error('M13 load fixture did not create DoctorProfile.');
    }

    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.doctorProfile.id,
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'M13 Load Clinic',
        addressLine1: '1 Load Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
        services: {
          create: {
            name: 'Consultation',
            durationMinutes: 30,
            status: 'ACTIVE',
          },
        },
      },
    });

    locationPublicIdentifier = location.publicIdentifier;
  });

  afterAll(async () => {
    if (app) await app.close();

    for (const [key, originalValue] of Object.entries(originalEnvironment)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it('sustains concurrent liveness, readiness and public-routing reads without HTTP failures', async () => {
    const health = await runLoad('health', 300, 30, async () => {
      await expectHttp200(baseUrl, '/app/health');
    });

    const readiness = await runLoad('readiness', 200, 20, async () => {
      await expectHttp200(baseUrl, '/app/ready');
    });

    const publicLocation = await runLoad(
      'public-practice-location',
      300,
      30,
      async () => {
        await expectHttp200(
          baseUrl,
          `/public/practice-locations/${locationPublicIdentifier}`,
        );
      },
    );

    expect(health.requestsPerSecond).toBeGreaterThan(0);
    expect(readiness.requestsPerSecond).toBeGreaterThan(0);
    expect(publicLocation.requestsPerSecond).toBeGreaterThan(0);
  }, 120_000);
});
