import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BookingDraftCleanupService } from '../booking/booking-draft-cleanup.service';
import { CommandIdempotencyCleanupService } from '../idempotency/command-idempotency-cleanup.service';
import { NotificationRetentionCleanupService } from '../notification/notification-retention-cleanup.service';
import { SecurityRetentionCleanupService } from '../privacy-retention/security-retention-cleanup.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';

const logger = new Logger('MaintenanceWorker');
const DEFAULT_INTERVAL_MS = 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInterval(): number {
  const raw =
    process.env.MAINTENANCE_WORKER_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 10_000 || value > 3_600_000) {
    throw new Error(
      'MAINTENANCE_WORKER_INTERVAL_MS must be between 10000 and 3600000 milliseconds.',
    );
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const intervalMs = readInterval();
  const bookingDraftCleanup = app.get(BookingDraftCleanupService);
  const commandCleanup = app.get(CommandIdempotencyCleanupService);
  const notificationCleanup = app.get(NotificationRetentionCleanupService);
  const securityCleanup = app.get(SecurityRetentionCleanupService);
  const rateLimit = app.get(RateLimitService);
  let stopping = false;

  const requestStop = () => {
    if (!stopping) logger.log('Maintenance worker shutdown requested.');
    stopping = true;
  };
  process.once('SIGTERM', requestStop);
  process.once('SIGINT', requestStop);

  logger.log('Maintenance worker started.');

  try {
    while (!stopping) {
      try {
        const now = new Date();
        await bookingDraftCleanup.runOnce(100, now);
        await securityCleanup.cleanupEligible(now, 100);
        await notificationCleanup.cleanupEligible(now, 100);
        await commandCleanup.cleanupExpired(now, 100);
        await rateLimit.cleanupExpired(now, 500);
      } catch {
        logger.error('Maintenance worker cycle failed.');
      }

      if (!stopping) await delay(intervalMs);
    }
  } finally {
    process.removeListener('SIGTERM', requestStop);
    process.removeListener('SIGINT', requestStop);
    await app.close();
    logger.log('Maintenance worker stopped.');
  }
}

void bootstrap().catch(() => {
  logger.error('Maintenance worker failed to start.');
  process.exitCode = 1;
});
