import { createHash } from 'crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  SubscriptionEntitlementEventType,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL_PURPOSE = 'notification-outbox:recipient-email';
const MAX_BATCH_SIZE = 500;

type TransitionDefinition = {
  eventType: SubscriptionEntitlementEventType;
  notificationType: NotificationType;
  effectiveAt: Date;
  message: string;
};

type ReconciliationResult = Awaited<
  ReturnType<
    SubscriptionEntitlementTransitionService['reconcileFinancialAccount']
  >
>;

@Injectable()
export class SubscriptionEntitlementTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly entitlementState: SubscriptionEntitlementService,
    private readonly protectedAccountPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async reconcileFinancialAccount(
    doctorFinancialAccountId: string,
    now = new Date(),
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.accountLocks.lockById(transaction, doctorFinancialAccountId);

      const entitlement =
        await transaction.doctorSubscriptionEntitlement.findUnique({
          where: { doctorFinancialAccountId },
          select: {
            id: true,
            doctorFinancialAccountId: true,
            paidThrough: true,
            graceEndsAt: true,
          },
        });
      if (!entitlement) {
        return { state: null, event: null, created: false };
      }

      const state = this.entitlementState.evaluateDates(
        entitlement.paidThrough,
        entitlement.graceEndsAt,
        now,
      );
      if (state === 'PAID') {
        return { state, event: null, created: false };
      }

      const transition: TransitionDefinition =
        state === 'GRACE'
          ? {
              eventType: SubscriptionEntitlementEventType.GRACE_ENTERED,
              notificationType: NotificationType.SUBSCRIPTION_GRACE_ENTERED,
              effectiveAt: entitlement.paidThrough,
              message:
                'Your subscription has entered its seven-day grace period.',
            }
          : {
              eventType: SubscriptionEntitlementEventType.SUSPENDED,
              notificationType: NotificationType.SUBSCRIPTION_SUSPENDED,
              effectiveAt: entitlement.graceEndsAt,
              message:
                'Your subscription access is currently unavailable. Please renew your subscription to restore access.',
            };

      const existing = await transaction.subscriptionEntitlementEvent.findFirst(
        {
          where: {
            doctorSubscriptionEntitlementId: entitlement.id,
            eventType: transition.eventType,
            effectiveAt: transition.effectiveAt,
          },
          select: { id: true },
        },
      );

      const event =
        existing ??
        (await transaction.subscriptionEntitlementEvent.create({
          data: {
            doctorSubscriptionEntitlementId: entitlement.id,
            doctorFinancialAccountId,
            eventType: transition.eventType,
            effectiveAt: transition.effectiveAt,
            subscriptionPurchaseId: null,
            createdAt: now,
          },
          select: { id: true },
        }));

      await this.ensureTransitionEmail(
        transaction,
        doctorFinancialAccountId,
        event.id,
        transition,
        now,
      );

      return { state, event, created: existing === null };
    });
  }

  async reconcileDueEntitlements(batchSize = 100, now = new Date()) {
    if (
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new InternalServerErrorException(
        'Subscription transition batch size is invalid.',
      );
    }

    const due = await this.prisma.doctorSubscriptionEntitlement.findMany({
      where: { paidThrough: { lte: now } },
      orderBy: [{ paidThrough: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { doctorFinancialAccountId: true },
    });

    const results: ReconciliationResult[] = [];
    for (const entitlement of due) {
      results.push(
        await this.reconcileFinancialAccount(
          entitlement.doctorFinancialAccountId,
          now,
        ),
      );
    }
    return results;
  }

  private async ensureTransitionEmail(
    transaction: Prisma.TransactionClient,
    doctorFinancialAccountId: string,
    eventId: string,
    transition: TransitionDefinition,
    now: Date,
  ): Promise<void> {
    const deliveryIdentityKey = this.hash(
      `${transition.notificationType}|${eventId}`,
    );
    const existingOutbox = await transaction.notificationOutbox.findUnique({
      where: { deliveryIdentityKey },
      select: { id: true },
    });
    if (existingOutbox) return;

    const financialAccount =
      await transaction.doctorFinancialAccount.findUnique({
        where: { id: doctorFinancialAccountId },
        select: { doctorUser: { select: { email: true } } },
      });
    if (!financialAccount?.doctorUser.email) {
      throw new InternalServerErrorException(
        'Subscription notification email destination is unavailable.',
      );
    }

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: transition.notificationType,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        subscriptionEntitlementEventId: eventId,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: this.protectedAccountPayload.encrypt(
          financialAccount.doctorUser.email,
          RECIPIENT_EMAIL_PURPOSE,
        ),
        messageBodyEncrypted: this.notificationPayload.encryptMessage(
          transition.message,
        ),
        providerIdempotencyKey: `financial:${deliveryIdentityKey}`,
        attemptCount: 0,
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS),
        createdAt: now,
      },
    });
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
