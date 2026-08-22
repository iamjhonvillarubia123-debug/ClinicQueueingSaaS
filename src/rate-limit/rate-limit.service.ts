import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RateLimitPolicy } from './rate-limit.decorator';

type CountRow = { requestCount: number };

@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async consume(
    policy: RateLimitPolicy,
    clientIp: string,
    subject: string,
    now = new Date(),
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const windowStartMs =
      Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
    const windowStart = new Date(windowStartMs);
    const expiresAt = new Date(windowStartMs + policy.windowMs);
    const scopeKey = createHash('sha256')
      .update(`${policy.id}|${clientIp}|${subject}`, 'utf8')
      .digest('hex');

    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      INSERT INTO "RateLimitBucket" (
        "scopeKey",
        "windowStart",
        "requestCount",
        "expiresAt",
        "updatedAt"
      ) VALUES (
        ${scopeKey},
        ${windowStart},
        1,
        ${expiresAt},
        ${now}
      )
      ON CONFLICT ("scopeKey", "windowStart")
      DO UPDATE SET
        "requestCount" = "RateLimitBucket"."requestCount" + 1,
        "updatedAt" = ${now}
      RETURNING "requestCount"
    `);

    const requestCount = rows[0]?.requestCount ?? policy.limit + 1;
    return {
      allowed: requestCount <= policy.limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  async cleanupExpired(now = new Date(), batchSize = 500): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
      throw new BadRequestException('Rate-limit cleanup batch size is invalid.');
    }

    return this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "RateLimitBucket"
      WHERE ("scopeKey", "windowStart") IN (
        SELECT "scopeKey", "windowStart"
        FROM "RateLimitBucket"
        WHERE "expiresAt" <= ${now}
        ORDER BY "expiresAt", "scopeKey", "windowStart"
        LIMIT ${batchSize}
      )
    `);
  }
}
