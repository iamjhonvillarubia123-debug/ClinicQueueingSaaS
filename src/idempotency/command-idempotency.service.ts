import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { CommandType, Prisma } from '../../generated/prisma/client';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

@Injectable()
export class CommandIdempotencyService {
  normalizeKey(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  deriveIdentity(input: {
    idempotencyKey: string;
    commandType: CommandType;
    scope: Record<string, CanonicalValue | undefined>;
  }): string {
    return this.sha256(
      this.canonicalize({
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        scope: input.scope,
      }),
    );
  }

  fingerprint(input: Record<string, CanonicalValue | undefined>): string {
    return this.sha256(this.canonicalize(input));
  }

  async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  async findReplay(
    transaction: TransactionClient,
    commandIdentityKey: string,
    requestFingerprint: string,
  ) {
    const replay = await transaction.commandIdempotency.findUnique({
      where: { commandIdentityKey },
    });
    if (!replay) return null;

    if (replay.requestFingerprint !== requestFingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }

    return replay;
  }

  completionTimes(now = new Date()): { completedAt: Date; expiresAt: Date } {
    return {
      completedAt: now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
    };
  }

  private canonicalize(value: unknown): string {
    return JSON.stringify(this.normalizeCanonicalValue(value));
  }

  private normalizeCanonicalValue(value: unknown): CanonicalValue {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeCanonicalValue(item));
    }
    if (typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const result: Record<string, CanonicalValue> = {};
      for (const key of Object.keys(source).sort()) {
        const item = source[key];
        if (item === undefined) continue;
        result[key] = this.normalizeCanonicalValue(item);
      }
      return result;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    throw new Error('Unsupported canonical idempotency value.');
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
