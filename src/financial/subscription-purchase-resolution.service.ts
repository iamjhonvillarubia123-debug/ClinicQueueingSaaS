import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountLockService } from './financial-account-lock.service';

@Injectable()
export class SubscriptionPurchaseResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountLocks: FinancialAccountLockService,
  ) {}

  async failPurchase(purchaseId: string, resolvedAt = new Date()) {
    return this.resolvePurchase(
      purchaseId,
      SubscriptionPurchaseStatus.FAILED,
      SubscriptionPaymentStatus.FAILED,
      resolvedAt,
    );
  }

  async expirePurchase(purchaseId: string, resolvedAt = new Date()) {
    return this.resolvePurchase(
      purchaseId,
      SubscriptionPurchaseStatus.EXPIRED,
      SubscriptionPaymentStatus.EXPIRED,
      resolvedAt,
    );
  }

  private async resolvePurchase(
    purchaseId: string,
    purchaseStatus: SubscriptionPurchaseStatus,
    paymentStatus: SubscriptionPaymentStatus,
    resolvedAt: Date,
  ) {
    if (
      purchaseStatus !== SubscriptionPurchaseStatus.FAILED &&
      purchaseStatus !== SubscriptionPurchaseStatus.EXPIRED
    ) {
      throw new InternalServerErrorException(
        'Invalid terminal subscription purchase status.',
      );
    }
    if (
      paymentStatus !== SubscriptionPaymentStatus.FAILED &&
      paymentStatus !== SubscriptionPaymentStatus.EXPIRED
    ) {
      throw new InternalServerErrorException(
        'Invalid terminal subscription payment status.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const purchase = await this.lockPurchase(transaction, purchaseId);
      if (!purchase) {
        throw new ConflictException('Subscription purchase is unavailable.');
      }

      if (purchase.status === purchaseStatus) {
        return { purchase, replayed: true };
      }
      if (purchase.status !== SubscriptionPurchaseStatus.PENDING) {
        throw new ConflictException(
          'Subscription purchase is no longer eligible for failure resolution.',
        );
      }

      await this.accountLocks.lockById(
        transaction,
        purchase.doctorFinancialAccountId,
      );

      const successfulPayment =
        await transaction.subscriptionPayment.findFirst({
          where: {
            subscriptionPurchaseId: purchase.id,
            status: SubscriptionPaymentStatus.SUCCEEDED,
          },
          select: { id: true },
        });
      if (successfulPayment) {
        throw new InternalServerErrorException(
          'Successful provider payment cannot be resolved as a failed subscription purchase.',
        );
      }

      await transaction.subscriptionPayment.updateMany({
        where: {
          subscriptionPurchaseId: purchase.id,
          status: SubscriptionPaymentStatus.PENDING,
        },
        data: {
          status: paymentStatus,
          failedAt: resolvedAt,
        },
      });

      if (!purchase.creditAmountApplied.equals(0)) {
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

        const terminalEntry =
          await transaction.subscriptionCreditEntry.findFirst({
            where: {
              relatedCreditEntryId: reservation.id,
              entryType: {
                in: [
                  SubscriptionCreditEntryType.PURCHASE_CONSUMED,
                  SubscriptionCreditEntryType.PURCHASE_RELEASED,
                ],
              },
            },
            select: { id: true, entryType: true },
          });
        if (
          terminalEntry?.entryType ===
          SubscriptionCreditEntryType.PURCHASE_CONSUMED
        ) {
          throw new InternalServerErrorException(
            'Consumed subscription credit cannot be released from a failed purchase.',
          );
        }
        if (!terminalEntry) {
          await transaction.subscriptionCreditEntry.create({
            data: {
              doctorFinancialAccountId: purchase.doctorFinancialAccountId,
              entryType: SubscriptionCreditEntryType.PURCHASE_RELEASED,
              amount: purchase.creditAmountApplied,
              subscriptionPurchaseId: purchase.id,
              relatedCreditEntryId: reservation.id,
              occurredAt: resolvedAt,
            },
          });
        }
      }

      const updated = await transaction.subscriptionPurchase.update({
        where: { id: purchase.id },
        data: { status: purchaseStatus },
      });

      return { purchase: updated, replayed: false };
    });
  }

  private async lockPurchase(
    transaction: Prisma.TransactionClient,
    purchaseId: string,
  ) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        doctorFinancialAccountId: string;
        creditAmountApplied: Prisma.Decimal;
        status: SubscriptionPurchaseStatus;
      }>
    >(Prisma.sql`
      SELECT
        "id",
        "doctorFinancialAccountId",
        "creditAmountApplied",
        "status"
      FROM "SubscriptionPurchase"
      WHERE "id" = ${purchaseId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }
}
