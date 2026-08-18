import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { App } from 'supertest/types';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { NotificationOutboxClaimService } from './../src/notification/notification-outbox-claim.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('NotificationOutbox claim concurrency controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let claimService: NotificationOutboxClaimService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    claimService = moduleFixture.get(NotificationOutboxClaimService);
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets only one worker claim one due outbox', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const now = new Date();
    const outbox = await prisma.notificationOutbox.create({
      data: {
        deliveryIdentityKey: scope,
        notificationType: NotificationType.SECURITY_NOTIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PENDING,
        recipientMobileEncrypted: `enc-${scope}`,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: `message-${scope}`,
        providerIdempotencyKey: `m9s1-${scope}`,
        attemptCount: 0,
        nextAttemptAt: new Date(now.getTime() - 1_000),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });

    const [workerA, workerB] = await Promise.all([
      claimService.claimNext(`worker-a-${scope.slice(0, 8)}`, 60_000, now),
      claimService.claimNext(`worker-b-${scope.slice(0, 8)}`, 60_000, now),
    ]);

    const claimed = [workerA, workerB].filter(
      (value): value is NonNullable<typeof value> => value !== null,
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(outbox.id);

    const stored = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(stored.status).toBe(NotificationOutboxStatus.PROCESSING);
    expect(stored.processingWorkerId).toBe(claimed[0].processingWorkerId);
    expect(stored.processingStartedAt?.getTime()).toBe(now.getTime());
    expect(stored.leaseExpiresAt?.getTime()).toBe(now.getTime() + 60_000);
  }, 30_000);
});
