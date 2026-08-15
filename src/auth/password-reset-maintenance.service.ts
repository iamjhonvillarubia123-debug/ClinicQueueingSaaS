import { Injectable } from '@nestjs/common';
import {
  NotificationOutboxStatus,
  NotificationType,
  PasswordResetStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PasswordResetMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async expirePendingBatch(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    const limit = this.normalizeBatchSize(batchSize);
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "PasswordReset"
        WHERE "status" = 'PENDING'
          AND "expiresAt" <= ${now}
        ORDER BY "expiresAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      await transaction.passwordReset.updateMany({
        where: {
          id: { in: ids },
          status: PasswordResetStatus.PENDING,
          expiresAt: { lte: now },
        },
        data: {
          status: PasswordResetStatus.EXPIRED,
          tokenHash: null,
          activeResetKey: null,
        },
      });

      await transaction.notificationOutbox.updateMany({
        where: {
          passwordResetId: { in: ids },
          notificationType: NotificationType.PASSWORD_RESET,
          status: NotificationOutboxStatus.PENDING,
        },
        data: {
          status: NotificationOutboxStatus.CANCELLED,
          cancelledAt: now,
        },
      });

      return ids.length;
    });
  }

  async revalidateOutboxForSend(outboxId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE "id" = ${outboxId}
        LIMIT 1
        FOR UPDATE
      `;
      if (!rows[0]) return false;

      const outbox = await transaction.notificationOutbox.findUnique({
        where: { id: outboxId },
        select: {
          id: true,
          notificationType: true,
          status: true,
          passwordResetId: true,
        },
      });

      if (
        !outbox ||
        outbox.notificationType !== NotificationType.PASSWORD_RESET ||
        outbox.status !== NotificationOutboxStatus.PENDING ||
        !outbox.passwordResetId
      ) {
        return false;
      }

      const resetRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "PasswordReset"
        WHERE "id" = ${outbox.passwordResetId}
        LIMIT 1
        FOR UPDATE
      `;
      if (!resetRows[0]) {
        await this.cancelOutbox(transaction, outbox.id, new Date());
        return false;
      }

      const reset = await transaction.passwordReset.findUnique({
        where: { id: outbox.passwordResetId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          tokenHash: true,
          activeResetKey: true,
        },
      });

      const now = new Date();
      if (!reset) {
        await this.cancelOutbox(transaction, outbox.id, now);
        return false;
      }

      if (
        reset.status === PasswordResetStatus.PENDING &&
        reset.expiresAt.getTime() <= now.getTime()
      ) {
        await transaction.passwordReset.update({
          where: { id: reset.id },
          data: {
            status: PasswordResetStatus.EXPIRED,
            tokenHash: null,
            activeResetKey: null,
          },
        });
        await this.cancelOutbox(transaction, outbox.id, now);
        return false;
      }

      const usable =
        reset.status === PasswordResetStatus.PENDING &&
        reset.tokenHash !== null &&
        reset.activeResetKey !== null;

      if (!usable) {
        await this.cancelOutbox(transaction, outbox.id, now);
        return false;
      }

      return true;
    });
  }

  async deleteEligibleTerminalBatch(
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<number> {
    const limit = this.normalizeBatchSize(batchSize);
    const cutoff = new Date(Date.now() - TERMINAL_RETENTION_MS);

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT pr."id"
        FROM "PasswordReset" pr
        LEFT JOIN "NotificationOutbox" no ON no."passwordResetId" = pr."id"
        WHERE no."id" IS NULL
          AND (
            (pr."status" = 'CONSUMED' AND pr."consumedAt" <= ${cutoff})
            OR (pr."status" = 'REVOKED' AND pr."revokedAt" <= ${cutoff})
            OR (pr."status" = 'EXPIRED' AND pr."expiresAt" <= ${cutoff})
          )
        ORDER BY pr."updatedAt" ASC
        LIMIT ${limit}
        FOR UPDATE OF pr SKIP LOCKED
      `;

      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      const result = await transaction.passwordReset.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    });
  }

  private async cancelOutbox(
    transaction: TransactionClient,
    outboxId: string,
    now: Date,
  ): Promise<void> {
    await transaction.notificationOutbox.updateMany({
      where: {
        id: outboxId,
        status: NotificationOutboxStatus.PENDING,
      },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  }

  private normalizeBatchSize(value: number): number {
    if (!Number.isInteger(value) || value < 1) return DEFAULT_BATCH_SIZE;
    return Math.min(value, MAX_BATCH_SIZE);
  }
}
