import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AppModule } from '../app.module';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationOutboxClaimService } from './notification-outbox-claim.service';
import { NotificationReconciliationWorkerService } from './notification-reconciliation-worker.service';
import { loadNotificationWorkerRuntimeConfig } from './notification-worker-runtime.config';
import { PhilSmsNotificationProviderAdapter } from './philsms-notification-provider.adapter';

const logger = new Logger('NotificationWorker');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 48);
  return `notify:${host}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const configService = app.get(ConfigService);
  const runtime = loadNotificationWorkerRuntimeConfig(configService);
  const claimService = app.get(NotificationOutboxClaimService);
  const deliveryWorker = app.get(NotificationDeliveryWorkerService);
  const reconciliationWorker = app.get(NotificationReconciliationWorkerService);
  const adapter = app.get(PhilSmsNotificationProviderAdapter);
  const workerId = buildWorkerId();
  let stopping = false;

  const requestStop = () => {
    if (!stopping) logger.log('Notification worker shutdown requested.');
    stopping = true;
  };
  process.once('SIGTERM', requestStop);
  process.once('SIGINT', requestStop);

  logger.log('Notification worker started.');

  const deliveryLoop = async () => {
    while (!stopping) {
      try {
        const claimed = await claimService.claimNext(
          workerId,
          runtime.leaseDurationMs,
        );
        if (claimed) {
          await deliveryWorker.deliverClaimed(claimed, adapter);
          continue;
        }
      } catch {
        logger.error('Notification delivery worker cycle failed.');
      }
      await delay(runtime.deliveryPollMs);
    }
  };

  const reconciliationLoop = async () => {
    while (!stopping) {
      try {
        await reconciliationWorker.reconcileNext(
          workerId,
          runtime.leaseDurationMs,
          adapter,
        );
      } catch {
        logger.error('Notification reconciliation worker cycle failed.');
      }
      await delay(runtime.reconciliationPollMs);
    }
  };

  try {
    await Promise.all([deliveryLoop(), reconciliationLoop()]);
  } finally {
    process.removeListener('SIGTERM', requestStop);
    process.removeListener('SIGINT', requestStop);
    await app.close();
    logger.log('Notification worker stopped.');
  }
}

void bootstrap().catch(() => {
  logger.error('Notification worker failed to start.');
  process.exitCode = 1;
});
