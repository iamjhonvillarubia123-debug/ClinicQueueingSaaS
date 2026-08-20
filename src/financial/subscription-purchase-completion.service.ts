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

type RestorationEvent = {
  id: string;
};

type LockedPurchase = NonNullable<
  Awaited<ReturnType<SubscriptionPurchaseCompletionService['lockPurchase']>>
>;

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
          'Provider payment amount does not match the outstanding subscription purchase amount.',
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
          !existingPayment.amount.equals(amount)
        ) {
          throw new ConflictException(
            'Provider payment reference is already associated with another payment.',
          );
        }
        if (existingPayment.status === SubscriptionPaymentStatus.SUCCEEDED) {
          if (purchase.status === SubscriptionPurchaseStatus.COMPLETED) {
            return this.loadCompletedResult(transaction, purchase.id);
          }
          throw new InternalServerErrorException(
            'Successful provider payment is not synchronized with the subscription purchase.',
          );
        }
      }

      if (purchase.status === SubscriptionPurchaseStatus.COMPLETED) {
        throw new ConflictException(
          'Subscription purchase has already been completed.',
        );
      }
      if (purchase.status !== SubscriptionPurchaseStatus.PENDING) {
        throw new ConflictException(
          'Subscription purchase is no longer eligible for payment confirmation.',
        );
      }

      if (existingPayment) {
        await transaction.subscriptionPayment.update({
          where: { id: existingPayment.id },
          data: {
            status: SubscriptionPaymentStatus.SUCCEEDED,
            confirmedAt,
            failedAt: null,
          },
        });
      } else {
        await transaction.subscriptionPayment.create({
          data: {
            subscriptionPurchaseId: purchase.id,
            provider,
            providerPaymentReference,
            amount,
            status: SubscriptionPaymentStatus.SUCCEEDED,
            initiatedAt: confirmedAt,
            confirmedAt,
            createdAt: confirmedAt,
          },
        });
      }

      return this.completeLockedPurchase(transaction, purchase, confirmedAt);
    });
  }

  private async completeLockedPurchase(
    transaction: Prisma.TransactionClient,
    purchase: LockedPurchase,
    completedAt: Date,
  ) {
    if (purchase.status === SubscriptionPurchaseStatus.COMPLETED) {
      return this.loadCompletedResult(transaction, purchase.id);
    }
    if (purchase.status !== SubscriptionPurchaseStatus.PENDING) {
      throw new ConflictException(
        'Subscription purchase is no longer eligible for completion.',
      );
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
    const wasSuspended =
      existingEntitlement !== null &&
      this.entitlementState.evaluateDates(
        existingEntitlement.paidThrough,
        existingEntitlement.graceEndsAt,
        completedAt,
      ) === 'SUSPENDED';

    const period = this.periods.resolvePeriod(
      purchase.monthsPurchased,
      completedAt,
      existingEntitlement?.paidThrough ?? null,
    );
    const graceEndsAt = new Date(
      period.periodEnd.getTime() + GRACE_DURATION_MS,
    );

    const entitlement = existingEntitlement
      ? await transaction.doctorSubscriptionEntitlement.update({
          where: { id: existingEntitlement.id },
          data: {
            paidThrough: period.periodEnd,
            graceEndsAt,
          },
        })
      : await transaction.doctorSubscriptionEntitlement.create({
          data: {
            doctorFinancialAccountId: purchase.doctorFinancialAccountId,
            paidThrough: period.periodEnd,
            graceEndsAt,
            createdAt: completedAt,
          },
        });

    const completedPurchase = await transaction.subscriptionPurchase.update({
      where: { id: purchase.id },
      data: {
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: SubscriptionPurchaseStatus.COMPLETED,
        completedAt,
      },
    });

    if (!purchase.creditAmountApplied.equals(0)) {
      const existingConsumption =
        await transaction.subscriptionCreditEntry.findFirst({
          where: {
            subscriptionPurchaseId: purchase.id,
            entryType: SubscriptionCreditEntryType.PURCHASE_CONSUMED,
          },
          select: { id: true },
        });
      if (!existingConsumption) {
        const reservation =
          await transaction.subscriptionCreditEntry.findFirst({
            where: {
              subscriptionPurchaseId: purchase.id,
              entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });
        if (
          !reservation ||
          !reservation.amount.equals(purchase.creditAmountApplied)
        ) {
          throw new InternalServerErrorException(
            'Subscription purchase credit reservation is unavailable or inconsistent.',
          );
        }
        await transaction.subscriptionCreditEntry.create({
          data: {
            doctorFinancialAccountId: purchase.doctorFinancialAccountId,
            entryType: SubscriptionCreditEntryType.PURCHASE_CONSUMED,
            amount: purchase.creditAmountApplied,
            subscriptionPurchaseId: purchase.id,
            relatedCreditEntryId: reservation.id,
            occurredAt: completedAt,
          },
        });
      }
    }

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

    let restorationEvent: RestorationEvent | null = null;
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
        select: { id: true },
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

  private async loadCompletedResult(
    transaction: Prisma.TransactionClient,
    purchaseId: string,
  ) {
    const purchase = await transaction.subscriptionPurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase || purchase.status !== SubscriptionPurchaseStatus.COMPLETED) {
      throw new InternalServerErrorException(
        'Completed subscription purchase result is unavailable.',
      );
    }
    const entitlement =
      await transaction.doctorSubscriptionEntitlement.findUnique({
        where: {
          doctorFinancialAccountId: purchase.doctorFinancialAccountId,
        },
      });
    if (!entitlement) {
      throw new InternalServerErrorException(
        'Completed subscription entitlement is unavailable.',
      );
    }
    return { purchase, entitlement, restorationEvent: null, replayed: true };
  }

  private async lockPurchase(
    transaction: Prisma.TransactionClient,
    purchaseId: string,
  ) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        doctorFinancialAccountId: string;
        purchasedByUserId: string;
        monthsPurchased: number;
        creditAmountApplied: Prisma.Decimal;
        externalAmountRequired: Prisma.Decimal;
        status: SubscriptionPurchaseStatus;
      }>
    >(Prisma.sql`
      SELECT
        "id",
        "doctorFinancialAccountId",
        "purchasedByUserId",
        "monthsPurchased",
        "creditAmountApplied",
        "externalAmountRequired",
        "status"
      FROM "SubscriptionPurchase"
      WHERE "id" = ${purchaseId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
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
    const deliveryIdentityKey = this.hash(
      `${input.notificationType}|${input.sourceId}`,
    );
    const existing = await transaction.notificationOutbox.findUnique({
      where: { deliveryIdentityKey },
      select: { id: true },
    });
    if (existing) return;

    await transaction.notificationOutbox.create({
      data: {
        deliveryIdentityKey,
        channel: NotificationChannel.EMAIL,
        notificationType: input.notificationType,
        status: NotificationOutboxStatus.PENDING,
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

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
