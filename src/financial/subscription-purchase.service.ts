import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPurchaseStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { StandardSubscriptionPriceService } from './standard-subscription-price.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';
import { SubscriptionPeriodService } from './subscription-period.service';
import { SubscriptionPurchaseQuoteService } from './subscription-purchase-quote.service';

type CreateSubscriptionPurchaseInput = {
  authenticatedUserId: string;
  monthsPurchased: number;
  idempotencyKey: string | undefined;
};

@Injectable()
export class SubscriptionPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly creditBalance: SubscriptionCreditBalanceService,
    private readonly price: StandardSubscriptionPriceService,
    private readonly quote: SubscriptionPurchaseQuoteService,
    private readonly periods: SubscriptionPeriodService,
  ) {}

  async create(input: CreateSubscriptionPurchaseInput) {
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const requestFingerprint = this.idempotency.fingerprint({
      monthsPurchased: input.monthsPurchased,
    });
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`doctor-financial-account:${input.authenticatedUserId}`},
            0
          )
        )
      `);

      const user = await transaction.user.findUnique({
        where: { id: input.authenticatedUserId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
        },
      });
      if (
        !user ||
        user.role !== UserRole.DOCTOR ||
        user.accountStatus !== UserAccountStatus.ACTIVE ||
        user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE
      ) {
        throw new ForbiddenException(
          'Only a current eligible Doctor may purchase subscription time.',
        );
      }

      let financialAccount =
        await transaction.doctorFinancialAccount.findUnique({
          where: { doctorUserId: user.id },
          select: { id: true, doctorUserId: true },
        });
      if (!financialAccount) {
        financialAccount = await transaction.doctorFinancialAccount.create({
          data: { doctorUserId: user.id },
          select: { id: true, doctorUserId: true },
        });
      }

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey,
        commandType: CommandType.DOCTOR_PURCHASE_SUBSCRIPTION,
        scope: { doctorFinancialAccountId: financialAccount.id },
      });
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        const purchase = await transaction.subscriptionPurchase.findUnique({
          where: { commandIdempotencyId: replay.id },
        });
        if (!purchase) {
          throw new InternalServerErrorException(
            'Committed subscription purchase result is unavailable.',
          );
        }
        return { purchase, replayed: true };
      }

      const lockedAccount = await this.accountLocks.lockById(
        transaction,
        financialAccount.id,
      );
      if (lockedAccount.doctorUserId !== user.id) {
        throw new InternalServerErrorException(
          'Doctor financial account ownership is inconsistent.',
        );
      }

      const balance = await this.creditBalance.derive(
        transaction,
        financialAccount.id,
      );
      const monthlyPrice = this.price.getMonthlyPrice();
      const quote = this.quote.quote(
        input.monthsPurchased,
        monthlyPrice,
        balance.available,
      );
      const entitlement =
        await transaction.doctorSubscriptionEntitlement.findUnique({
          where: { doctorFinancialAccountId: financialAccount.id },
          select: { paidThrough: true },
        });
      const period = this.periods.resolvePeriod(
        input.monthsPurchased,
        now,
        entitlement?.paidThrough ?? null,
      );

      const times = this.idempotency.completionTimes(now);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey,
          commandIdentityKey,
          commandType: CommandType.DOCTOR_PURCHASE_SUBSCRIPTION,
          requestFingerprint,
          actorUserId: user.id,
          accountUserId: user.id,
          doctorFinancialAccountId: financialAccount.id,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      const purchase = await transaction.subscriptionPurchase.create({
        data: {
          doctorFinancialAccountId: financialAccount.id,
          purchasedByUserId: user.id,
          monthsPurchased: quote.monthsPurchased,
          monthlyPriceSnapshot: new Prisma.Decimal(
            quote.monthlyPriceSnapshot,
          ),
          grossAmount: new Prisma.Decimal(quote.grossAmount),
          creditAmountApplied: new Prisma.Decimal(quote.creditAmountApplied),
          externalAmountRequired: new Prisma.Decimal(
            quote.externalAmountRequired,
          ),
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: SubscriptionPurchaseStatus.PENDING,
          commandIdempotencyId: command.id,
          createdAt: now,
        },
      });

      if (quote.creditAmountApplied !== '0.00') {
        await transaction.subscriptionCreditEntry.create({
          data: {
            doctorFinancialAccountId: financialAccount.id,
            entryType: SubscriptionCreditEntryType.PURCHASE_RESERVED,
            amount: new Prisma.Decimal(quote.creditAmountApplied),
            subscriptionPurchaseId: purchase.id,
            commandIdempotencyId: command.id,
            occurredAt: now,
          },
        });
      }

      return { purchase, replayed: false };
    });
  }
}
