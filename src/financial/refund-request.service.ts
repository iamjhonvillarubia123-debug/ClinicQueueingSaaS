import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CommandType,
  NotificationType,
  Prisma,
  RefundMethod,
  RefundRequestStatus,
  SubscriptionCreditEntryType,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccessSessionService } from './financial-access-session.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { RefundNotificationService } from './refund-notification.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';

const ACCOUNT_NAME_PURPOSE = 'refund-request:account-name';
const DESTINATION_PURPOSE = 'refund-request:destination';

type CreateRefundRequestInput = {
  financialAccessToken: string;
  idempotencyKey: string | undefined;
  requestedAmount: string;
  reasonCode: string;
  otherReasonText?: string | null;
  method: RefundMethod;
  accountName: string;
  destination: string;
  destinationConfirmation: string;
  acknowledged: boolean;
};

@Injectable()
export class RefundRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialAccess: FinancialAccessSessionService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly creditBalance: SubscriptionCreditBalanceService,
    private readonly protectedPayload: ProtectedAccountPayloadService,
    private readonly refundNotifications: RefundNotificationService,
  ) {}

  async create(input: CreateRefundRequestInput) {
    const authority = await this.financialAccess.authorize(
      input.financialAccessToken,
    );
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const requestedAmount = this.parseAmount(input.requestedAmount);
    const reasonCode = input.reasonCode.trim();
    const otherReasonText = input.otherReasonText?.trim() || null;
    const accountName = input.accountName.trim();
    const destination = input.destination.trim();
    const destinationConfirmation = input.destinationConfirmation.trim();

    if (!input.acknowledged) {
      throw new BadRequestException(
        'Final refund acknowledgement is required.',
      );
    }
    if (!reasonCode || reasonCode.length > 100) {
      throw new BadRequestException('Refund reason is invalid.');
    }
    if (otherReasonText && otherReasonText.length > 1000) {
      throw new BadRequestException('Refund reason detail is too long.');
    }
    if (!accountName) {
      throw new BadRequestException('Refund account name is required.');
    }
    if (
      !destination ||
      destination.length < 4 ||
      destination !== destinationConfirmation
    ) {
      throw new BadRequestException(
        'Refund destination entries must match and contain at least four characters.',
      );
    }

    const requestFingerprint = this.idempotency.fingerprint({
      requestedAmount: requestedAmount.toFixed(2),
      reasonCode,
      otherReasonHash: otherReasonText ? this.sha256(otherReasonText) : null,
      method: input.method,
      accountNameHash: this.sha256(accountName),
      destinationHash: this.sha256(destination),
      acknowledged: true,
    });
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const lockedAccount = await this.accountLocks.lockById(
        transaction,
        authority.doctorFinancialAccountId,
      );
      const owner = await transaction.user.findUnique({
        where: { id: lockedAccount.doctorUserId },
        select: { accountStatus: true, email: true },
      });
      if (
        !owner ||
        owner.accountStatus !== UserAccountStatus.PERMANENTLY_CLOSED
      ) {
        throw new ForbiddenException(
          'Cash refund is available only for a permanently closed Doctor account.',
        );
      }
      if (!owner.email) {
        throw new InternalServerErrorException(
          'Refund notification recipient is unavailable.',
        );
      }

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey,
        commandType: CommandType.DOCTOR_REQUEST_REFUND,
        scope: {
          doctorFinancialAccountId: authority.doctorFinancialAccountId,
        },
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
        const refundRequest = await transaction.refundRequest.findUnique({
          where: { commandIdempotencyId: replay.id },
        });
        if (!refundRequest) {
          throw new InternalServerErrorException(
            'Committed refund request result is unavailable.',
          );
        }
        return { refundRequest, replayed: true };
      }

      const balance = await this.creditBalance.derive(
        transaction,
        authority.doctorFinancialAccountId,
      );
      if (requestedAmount.greaterThan(new Prisma.Decimal(balance.available))) {
        throw new BadRequestException(
          'Requested refund exceeds available refundable credit.',
        );
      }

      const times = this.idempotency.completionTimes(now);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey,
          commandIdentityKey,
          commandType: CommandType.DOCTOR_REQUEST_REFUND,
          requestFingerprint,
          actorUserId: null,
          accountUserId: null,
          doctorFinancialAccountId: authority.doctorFinancialAccountId,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      const refundRequest = await transaction.refundRequest.create({
        data: {
          doctorFinancialAccountId: authority.doctorFinancialAccountId,
          requestedAmount,
          reasonCode,
          otherReasonText,
          method: input.method,
          accountNameProtected: this.protectedPayload.encrypt(
            accountName,
            ACCOUNT_NAME_PURPOSE,
          ),
          destinationProtected: this.protectedPayload.encrypt(
            destination,
            DESTINATION_PURPOSE,
          ),
          destinationLast4: destination.slice(-4),
          status: RefundRequestStatus.PENDING,
          submittedAt: now,
          commandIdempotencyId: command.id,
        },
      });

      await transaction.subscriptionCreditEntry.create({
        data: {
          doctorFinancialAccountId: authority.doctorFinancialAccountId,
          entryType: SubscriptionCreditEntryType.REFUND_RESERVED,
          amount: requestedAmount,
          refundRequestId: refundRequest.id,
          commandIdempotencyId: command.id,
          occurredAt: now,
        },
      });

      await this.refundNotifications.create(transaction, {
        notificationType: NotificationType.REFUND_REQUEST_SUBMITTED,
        refundRequestId: refundRequest.id,
        recipientEmail: owner.email,
        message: `Your refund request for ${requestedAmount.toFixed(2)} has been submitted for processing.`,
        occurredAt: now,
      });

      return { refundRequest, replayed: false };
    });
  }

  private parseAmount(value: string): Prisma.Decimal {
    const normalized = value.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
      throw new BadRequestException(
        'Requested refund must be a positive amount with at most two decimal places.',
      );
    }
    const amount = new Prisma.Decimal(normalized);
    if (!amount.greaterThan(0)) {
      throw new BadRequestException(
        'Requested refund must be greater than zero.',
      );
    }
    return amount;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
