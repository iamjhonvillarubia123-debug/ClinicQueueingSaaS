import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

type CommandIdRow = { id: string };

export type CommandIdempotencyCleanupResult = {
  examined: number;
  deleted: number;
};

@Injectable()
export class CommandIdempotencyCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanupExpired(
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<CommandIdempotencyCleanupResult> {
    if (
      !Number.isInteger(batchSize) ||
      batchSize <= 0 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Command idempotency cleanup batch size is invalid.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<CommandIdRow[]>(Prisma.sql`
        SELECT "id"
        FROM "CommandIdempotency"
        WHERE "expiresAt" <= ${now}
        ORDER BY "expiresAt", "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);

      if (rows.length === 0) {
        return { examined: 0, deleted: 0 };
      }

      const ids = rows.map((row) => row.id);
      const deletion = await transaction.commandIdempotency.deleteMany({
        where: {
          id: { in: ids },
          expiresAt: { lte: now },
        },
      });

      return {
        examined: rows.length,
        deleted: deletion.count,
      };
    });
  }
}
