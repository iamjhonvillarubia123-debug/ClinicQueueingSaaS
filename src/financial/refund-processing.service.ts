import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationType,
  Prisma,
  RefundRequestStatus,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { RefundNotificationService } from './refund-notification.service';

type CompleteRefundInput = {
  authenticatedSystemAdminUserId: string;
  refundRequestId: string;
  idempotencyKey: string | undefined;
  provider: string;
  attemptReference: string;
  completionReference: string;
  proofReference: string;
  transferConfirmed: boolean;
  completedAt?: Date;
};

type FailRefundInput = {
  authenticatedSystemAdminUserId: string;
  refundRequestId: string;
  idempotencyKey: string | undefined;
  provider: string;
  attemptReference: string;
  failureCategory: string;
  failureDetailSanitized?: string | null;
  confirmedNonRecoverable: boolean;
  failedAt?: Date;
};

@Injectable()
export class RefundProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly refundNotifications: RefundNotificationService,
  ) {}

  async complete(input: CompleteRefundInput) {
    if (!input.transferConfirmed) {
      throw new BadRequestException(
        'Refund completion requires confirmation that the transfer actually occurred.',
      );
    }
    const provider = this.requireText(input.provider, 'Refund provider', 100);
    const attemptReference = this.requireText(
      input.attemptReference,
      'Refund attempt reference',
      255,
    );
    const completionReference = this.requireText(
      input.completionReference,
      'Refund completion reference',
      255,
    );
    const proofReference = this.requireText(
      input.proofReference,
      'Refund proof reference',
      500,
    );
    const completedAt = input.completedAt ?? new Date();
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const requestFingerprint = this.idempotency.fingerprint({
      refundRequestId: input.refundRequestId,
      provider,
      attemptReference,
      completionReference,
      proofReference,
      transferConfirmed: true,
    });

    return this.processTerminal({
      actorUserId: input.authenticatedSystemAdminUserId,
      refundRequestId: input.refundRequestId,
      idempotencyKey,
      requestFingerprint,
      commandType: CommandType.SYSTEM_ADMIN_COMPLETE_REFUND,
      targetStatus: RefundRequestStatus.COMPLETED,
      occurredAt: completedAt,
      provider,
      attemptReference,
      outcome: 'TRANSFER_COMPLETED',
      failureCategory: null,
      failureDetailSanitized: null,
      completionReference,
      proofReference,
    });
  }

  async fail(input: FailRefundInput) {
    if (!input.confirmedNonRecoverable) {
      throw new BadRequestException(
        'Terminal refund failure requires confirmed non-recoverable status.',
      );
    }
    const provider = this.requireText(input.provider, 'Refund provider', 100);
    const attemptReference = this.requireText(
      input.attemptReference,
      'Refund attempt reference',
      255,
    );
    const failureCategory = this.requireText(
      input.failureCategory,
      'Refund failure category',
      100,
    );
    const failureDetailSanitized = input.failureDetailSanitized?.trim() || null;
    if (failureDetailSanitized && failureDetailSanitized.length > 1000) {
      throw new BadRequestException('Refund failure detail is too long.');
    }
    const failedAt = input.failedAt ?? new Date();
    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const requestFingerprint = this.idempotency.fingerprint({
      refundRequestId: input.refundRequestId,
      provider,
      attemptReference,
      failureCategory,
      failureDetailSanitized,
      confirmedNonRecoverable: true,
    });

    return this.processTerminal({
      actorUserId: input.authenticatedSystemAdminUserId,
      refundRequestId: input.refundRequestId,
      idempotencyKey,
      requestFingerprint,
      commandType: CommandType.SYSTEM_ADMIN_FAIL_REFUND,
      targetStatus: RefundRequestStatus.FAILED,
      occurredAt: failedAt,
      provider,
      attemptReference,
      outcome: 'NON_RECOVERABLE_FAILURE',
      failureCategory,
      failureDetailSanitized,
      completionReference: null,
      proofReference: null,
    });
  }

  private async processTerminal(input: {
    actorUserId: string;
    refundRequestId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    commandType: CommandType;
    targetStatus: RefundRequestStatus;
    occurredAt: Date;
    provider: string;
    attemptReference: string;
    outcome: string;
    failureCategory: string | null;
    failureDetailSanitized: string | null;
    completionReference: string | null;
    proofReference: string | null;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      const refund = await this.lockRefundRequest(
        transaction,
        input.refundRequestId,
      );
      if (!refund) {
        throw new BadRequestException('Refund request is unavailable.');
      }

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey: input.idempotencyKey,
        commandType: input.commandType,
        scope: {
          actorUserId: input.actorUserId,
          doctorFinancialAccountId: refund.doctorFinancialAccountId,
          refundRequestId: refund.id,
        },
      });
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        input.requestFingerprint,
      );
      if (replay) {
        const replayedRefund = await transaction.refundRequest.findUnique({
          where: { id: refund.id },
        });
        if (!replayedRefund || replayedRefund.status !== input.targetStatus) {
          throw new InternalServerErrorException(
            'Committed refund processing result is unavailable.',
          );
        }
        return { refundRequest: replayedRefund, replayed: true };
      }

      if (refund.status !== RefundRequestStatus.PENDING) {
        throw new BadRequestException(
          'Refund request is no longer eligible for terminal processing.',
        );
      }

      const lockedAccount = await this.accountLocks.lockById(
        transaction,
        refund.doctorFinancialAccountId,
      );
      const actor = await transaction.user.findUnique({
        where: { id: input.actorUserId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
        },
      });
      if (
        !actor ||
        actor.role !== UserRole.SYSTEM_ADMIN ||
        actor.accountStatus !== UserAccountStatus.ACTIVE ||
        actor.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE
      ) {
        throw new ForbiddenException('SYSTEM_ADMIN authority is required.');
      }

      const reservation = await transaction.subscriptionCreditEntry.findFirst({
        where: {
          refundRequestId: refund.id,
          entryType: SubscriptionCreditEntryType.REFUND_RESERVED,
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      if (!reservation || !reservation.amount.equals(refund.requestedAmount)) {
        throw new InternalServerErrorException(
          'Refund reservation is unavailable or inconsistent.',
        );
      }

      const times = this.idempotency.completionTimes(input.occurredAt);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          commandIdentityKey,
          commandType: input.commandType,
          requestFingerprint: input.requestFingerprint,
          actorUserId: actor.id,
          accountUserId: null,
          doctorFinancialAccountId: refund.doctorFinancialAccountId,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      await transaction.refundProcessingAttempt.create({
        data: {
          refundRequestId: refund.id,
          processedBySystemAdminUserId: actor.id,
          provider: input.provider,
          attemptReference: input.attemptReference,
          attemptedAt: input.occurredAt,
          outcome: input.outcome,
          failureCategory: input.failureCategory,
          failureDetailSanitized: input.failureDetailSanitized,
        },
      });

      if (input.targetStatus === RefundRequestStatus.FAILED) {
        const existingRelease =
          await transaction.subscriptionCreditEntry.findFirst({
            where: {
              relatedCreditEntryId: reservation.id,
              entryType: SubscriptionCreditEntryType.REFUND_FAILED_RELEASED,
            },
            select: { id: true },
          });
        if (existingRelease) {
          throw new InternalServerErrorException(
            'Failed refund reservation was already released.',
          );
        }
        await transaction.subscriptionCreditEntry.create({
          data: {
            doctorFinancialAccountId: refund.doctorFinancialAccountId,
            entryType: SubscriptionCreditEntryType.REFUND_FAILED_RELEASED,
            amount: refund.requestedAmount,
            refundRequestId: refund.id,
            relatedCreditEntryId: reservation.id,
            commandIdempotencyId: command.id,
            occurredAt: input.occurredAt,
          },
        });
      }

      const updated = await transaction.refundRequest.update({
        where: { id: refund.id },
        data:
          input.targetStatus === RefundRequestStatus.COMPLETED
            ? {
                status: RefundRequestStatus.COMPLETED,
                completedAt: input.occurredAt,
                failedAt: null,
                processedBySystemAdminUserId: actor.id,
                completionReference: input.completionReference,
                proofReference: input.proofReference,
              }
            : {
                status: RefundRequestStatus.FAILED,
                completedAt: null,
                failedAt: input.occurredAt,
                processedBySystemAdminUserId: actor.id,
                completionReference: null,
                proofReference: null,
              },
      });

      const owner = await transaction.user.findUnique({
        where: { id: lockedAccount.doctorUserId },
        select: { email: true },
      });
      if (!owner?.email) {
        throw new InternalServerErrorException(
          'Refund notification recipient is unavailable.',
        );
      }
      await this.refundNotifications.create(transaction, {
        notificationType:
          input.targetStatus === RefundRequestStatus.COMPLETED
            ? NotificationType.REFUND_COMPLETED
            : NotificationType.REFUND_FAILED,
        refundRequestId: refund.id,
        recipientEmail: owner.email,
        message:
          input.targetStatus === RefundRequestStatus.COMPLETED
            ? `Your refund request has been completed. Reference: ${input.completionReference}.`
            : 'Your refund request could not be completed and the reserved credit has been returned to your financial account.',
        occurredAt: input.occurredAt,
      });

      return { refundRequest: updated, replayed: false };
    });
  }

  private async lockRefundRequest(
    transaction: Prisma.TransactionClient,
    refundRequestId: string,
  ) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        doctorFinancialAccountId: string;
        requestedAmount: Prisma.Decimal;
        status: RefundRequestStatus;
      }>
    >(Prisma.sql`
      SELECT
        "id",
        "doctorFinancialAccountId",
        "requestedAmount",
        "status"
      FROM "RefundRequest"
      WHERE "id" = ${refundRequestId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private requireText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
      throw new BadRequestException(`${label} is invalid.`);
    }
    return normalized;
  }
}
