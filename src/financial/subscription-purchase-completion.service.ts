import { createHash } from 'crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionEntitlementEventType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const RECIPIENT_EMAIL_PURPOSE = 'notification-outbox:recipient-email';

type ConfirmExternalPaymentInput = {
  purchaseId: string;
  provider: string;
  providerPaymentReference: string;
  amount: string;
  confirmedAt?: Date;
};

@Injectable()
export class SubscriptionPurchaseCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly entitlementState: SubscriptionEntitlementService,
    private readonly periods: SubscriptionPeriodService,
    private readonly protectedAccountPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async completeCreditOnly(purchaseId: string, completedAt = new Date()) {
    return this.prisma.$transaction(async (transaction) => {
      const purchase = await this.lockPurchase(transaction, purchaseId);
      if (!purchase) {
        throw new ConflictException('Subscription purchase is unavailable.');
      }
      if (!purchase.externalAmountRequired.equals(0)) {
        throw new ConflictException(
          'Subscription purchase still requires external payment.',
        );
      }
      return this.completeLockedPurchase(transaction, purchase, completedAt);
    });
  }

  async confirmExternalPayment(input: ConfirmExternalPaymentInput) {
    const confirmedAt = input.confirmedAt ?? new Date();
    const provider = input.provider.trim();
    const providerPaymentReference = input.providerPaymentReference.trim();
    if (!provider || !providerPaymentReference) {
      throw new ConflictException('Provider payment identity is required.');
    }
    const amount = new Prisma.Decimal(input.amount);

    return this.prisma.$transaction(async (transaction) => {
      const purchase = await this.lockPurchase(transaction, input.purchaseId);
      if (!purchase) {
        throw new ConflictException('Subscription purchase is unavailable.');
      }
      if (purchase.externalAmountRequired.equals(0)) {
        throw new ConflictException(
          'Credit-only subscription purchase does not require provider payment.',
        );
      }
      if (!amount.equals(purchase.externalAmountRequired)) {
        throw new ConflictException(
          'Provider payment amount does not match the purchase balance.',
        );
      }

      const existingPayment = await transaction.subscriptionPayment.findUnique({
        where: {
          provider_providerPaymentReference: {
            provider,
            providerPaymentReference,
          },
        },
      });
      if (existingPayment) {
        if (
          existingPayment.subscriptionPurchaseId !== purchase.id ||
          existingPayment.status !== SubscriptionPaymentStatus.SUCCEEDED ||
          !existingPayment.amount.equals(amount)
        ) {
          throw new ConflictException(
            'Provider payment reference is already associated with another payment result.',
          );
        }
        const completed = await this.completeLockedPurchase(
          transaction,
          purchase,
          existingPayment.confirmedAt ?? confirmedAt,
        );
        return { ...completed, payment: existingPayment, paymentReplayed: true };
      }

      const payment = await transaction.subscriptionPayment.create({
        data: {
          subscriptionPurchaseId: purchase.id,
          provider,
          providerPaymentReference,
          amount,
          status: SubscriptionPaymentStatus.SUCCEEDED,
          initiatedAt: confirmedAt,
          confirmedAt,
          createdAt: confirmedAt,
          updatedAt: confirmedAt,
        },
      });
      const completed = await this.completeLockedPurchase(
        transaction,
        purchase,
        confirmedAt,
      );
      return { ...completed, payment, paymentReplayed: false };
    });
  }

  private async lockPurchase(
    transaction: Prisma.TransactionClient,
    purchaseId: string,
  ) {
    const rows = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "SubscriptionPurchase"
      WHERE "id" = ${purchaseId}
      FOR UPDATE
    `);
    if (!rows[0]) return null;
    return transaction.subscriptionPurchase.findUnique({
      where: { id: purchaseId },
    });
  }

  private async completeLockedPurchase(
    transaction: Prisma.TransactionClient,
    purchase: NonNullable<Awaited<ReturnType<SubscriptionPurchaseCompletionService['lockPurchase']>>>,
    completedAt: Date,
  ) {
    if (purchase.status === SubscriptionPurchaseStatus.COMPLETED) {
      return { purchase, replayed: true };
    }
    if (purchase.status !== SubscriptionPurchaseStatus.PENDING) {
      throw new ConflictException('Subscription purchase cannot be completed.');
    }

    await this.accountLocks.lockById(
      transaction,
      purchase.doctorFinancialAccountId,
    );

    const existingEntitlement =
      await transaction.doctorSubscriptionEntitlement.findUnique({
        where: {
          doctorFinancialAccountId: purchase.doctorFinancialAccountId,
        },
      });
    const wasSuspended = existingEntitlement
      ? this.entitlementState.evaluateDates(
          existingEntitlement.paidThrough,
          existingEntitlement.graceEndsAt,
          completedAt,
        ) === 'SUSPENDED'
      : false;
    const period = this.periods.resolvePeriod(
      purchase.monthsPurchased,
      completedAt,
      existingEntitlement?.paidThrough ?? null,
    );
    const graceEndsAt = new Date(period.periodEnd.getTime() + GRACE_DURATION_MS);

    const entitlement = existingEntitlement
      ? await transaction.doctorSubscriptionEntitlement.update({
          where: { id: existingEntitlement.id },
          data: { paidThrough: period.periodEnd, graceEndsAt },
        })
      : await transaction.doctorSubscriptionEntitlement.create({
          data: {
            doctorFinancialAccountId: purchase.doctorFinancialAccountId,
            paidThrough: period.periodEnd,
            graceEndsAt,
          },
        });

    if (!purchase.creditAmountApplied.equals(0)) {
      const consumed = await transaction.subscriptionCreditEntry.findFirst({
        where: {
          subscriptionPurchaseId: purchase.id,
          entryType: SubscriptionCreditEntryType.PURCHASE_CONSUMED,
        },
        select: { id: true },
      });
      if (!consumed) {
        const reservation = await transaction.subscriptionCreditEntry.findFirst({
          where: {
            subscriptionPurchaseId: purchase.id,
            entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
          },
          orderBy: { occurredAt: 'asc' },
          select: { id: true, amount: true, commandIdempotencyId: true },
        });
        if (!reservation || !reservation.amount.equals(purchase.creditAmountApplied)) {
          throw new InternalServerErrorException(
            'Subscription purchase credit reservation is inconsistent.',
          );
        }
        await transaction.subscriptionCreditEntry.create({
          data: {
            doctorFinancialAccountId: purchase.doctorFinancialAccountId,
            entryType: SubscriptionCreditEntryType.PURCHASE_CONSUMED,
            amount: purchase.creditAmountApplied,
            subscriptionPurchaseId: purchase.id,
            relatedCreditEntryId: reservation.id,
            commandIdempotencyId: reservation.commandIdempotencyId,
            occurredAt: completedAt,
          },
        });
      }
    }

    const completedPurchase = await transaction.subscriptionPurchase.update({
      where: { id: purchase.id },
      data: {
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: SubscriptionPurchaseStatus.COMPLETED,
        completedAt,
      },
    });

    const doctor = await transaction.user.findUnique({
      where: { id: purchase.purchasedByUserId },
      select: { email: true },
    });
    if (!doctor?.email) {
      throw new InternalServerErrorException(
        'Subscription purchase email destination is unavailable.',
      );
    }

    await this.createEmailOutbox(transaction, {
      notificationType: NotificationType.SUBSCRIPTION_PAYMENT_SUCCEEDED,
      sourceId: purchase.id,
      subscriptionPurchaseId: purchase.id,
      subscriptionEntitlementEventId: null,
      recipientEmail: doctor.email,
      message: `Your subscription purchase for ${purchase.monthsPurchased} month(s) was completed successfully.`,
      completedAt,
    });

    let restorationEvent = null;
    if (wasSuspended) {
      restorationEvent = await transaction.subscriptionEntitlementEvent.create({
        data: {
          doctorSubscriptionEntitlementId: entitlement.id,
          doctorFinancialAccountId: purchase.doctorFinancialAccountId,
          eventType: SubscriptionEntitlementEventType.RESTORED,
          effectiveAt: completedAt,
          subscriptionPurchaseId: purchase.id,
          createdAt: completedAt,
        },
      });
      await this.createEmailOutbox(transaction, {
        notificationType: NotificationType.SUBSCRIPTION_RESTORED,
        sourceId: restorationEvent.id,
        subscriptionPurchaseId: null,
        subscriptionEntitlementEventId: restorationEvent.id,
        recipientEmail: doctor.email,
        message: 'Your subscription access has been restored.',
        completedAt,
      });
    }

    return {
      purchase: completedPurchase,
      entitlement,
      restorationEvent,
      replayed: false,
    };
  }

  private async createEmailOutbox(
    transaction: Prisma.TransactionClient,
    input: {
      notificationType: NotificationType;
      sourceId: string;
      subscriptionPurchaseId: string | null;
      subscriptionEntitlementEventId: string | null;
      recipientEmail: string;
      message: string;
      completedAt: Date;
    },
  ) {
    const deliveryIdentityKey = createHash('sha256')
      .update(`${input.notificationType}|${input.sourceId}`, 'utf8')
      .digest('hex');
    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        notificationType: input.notificationType,
        channel: NotificationChannel.EMAIL,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        subscriptionPurchaseId: input.subscriptionPurchaseId,
        subscriptionEntitlementEventId: input.subscriptionEntitlementEventId,
        recipientMobileEncrypted: null,
        recipientEmailEncrypted: this.protectedAccountPayload.encrypt(
          input.recipientEmail,
          RECIPIENT_EMAIL_PURPOSE,
        ),
        messageBodyEncrypted: this.notificationPayload.encryptMessage(
          input.message,
        ),
        providerIdempotencyKey: `financial:${deliveryIdentityKey}`,
        attemptCount: 0,
        nextAttemptAt: input.completedAt,
        expiresAt: new Date(
          input.completedAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
        ),
        createdAt: input.completedAt,
      },
    });
  }
}
