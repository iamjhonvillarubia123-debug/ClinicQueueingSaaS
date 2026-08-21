import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserAccountStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CLOSED_USER_MINIMIZATION_DAYS = 7;
const ACCOUNT_AUDIT_BASELINE_YEARS = 5;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1000;

type ClosedUserCandidate = {
  userId: string;
};

export type AccountAdministrativeRetentionResult = {
  closedUsersMinimized: number;
  closureAuditsAtBaseline: number;
  administrativeActionsAtBaseline: number;
};

@Injectable()
export class AccountAdministrativeRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<AccountAdministrativeRetentionResult> {
    this.validateBatchSize(batchSize);

    const minimizationCutoff = new Date(
      now.getTime() - CLOSED_USER_MINIMIZATION_DAYS * 24 * 60 * 60 * 1000,
    );
    const auditCutoff = new Date(now);
    auditCutoff.setUTCFullYear(
      auditCutoff.getUTCFullYear() - ACCOUNT_AUDIT_BASELINE_YEARS,
    );

    return this.prisma.$transaction(async (transaction) => {
      const closedUsersMinimized = await this.minimizeClosedUsers(
        transaction,
        minimizationCutoff,
        batchSize,
      );
      const closureAuditsAtBaseline =
        await transaction.accountPermanentClosureAudit.count({
          where: { occurredAt: { lte: auditCutoff } },
        });
      const administrativeActionsAtBaseline =
        await transaction.administrativeAccountAction.count({
          where: { occurredAt: { lte: auditCutoff } },
        });

      return {
        closedUsersMinimized,
        closureAuditsAtBaseline,
        administrativeActionsAtBaseline,
      };
    });
  }

  private async minimizeClosedUsers(
    transaction: Prisma.TransactionClient,
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    const candidates = await transaction.$queryRaw<ClosedUserCandidate[]>(
      Prisma.sql`
        SELECT audit."accountUserId" AS "userId"
        FROM "AccountPermanentClosureAudit" audit
        INNER JOIN "User" account_user
          ON account_user."id" = audit."accountUserId"
        WHERE audit."occurredAt" <= ${cutoff}
          AND account_user."accountStatus" = ${UserAccountStatus.PERMANENTLY_CLOSED}::"UserAccountStatus"
          AND (
            account_user."email" NOT LIKE 'closed-%@invalid.local'
            OR account_user."firstName" <> 'Closed'
            OR account_user."middleName" IS NOT NULL
            OR account_user."lastName" <> 'Account'
            OR account_user."mobileNumber" NOT LIKE 'closed-%'
            OR account_user."passwordHash" NOT LIKE '!closed:%'
            OR account_user."emailVerifiedAt" IS NOT NULL
            OR account_user."lastLoginAt" IS NOT NULL
          )
        ORDER BY audit."occurredAt" ASC, audit."id" ASC
        LIMIT ${batchSize}
        FOR UPDATE OF account_user SKIP LOCKED
      `,
    );

    let minimized = 0;
    for (const candidate of candidates) {
      const suffix = this.tombstoneSuffix(candidate.userId);
      const email = `closed-${suffix}@invalid.local`;
      const mobileNumber = `closed-${suffix}`;
      const passwordHash = `!closed:${suffix}`;

      const result = await transaction.user.updateMany({
        where: {
          id: candidate.userId,
          accountStatus: UserAccountStatus.PERMANENTLY_CLOSED,
        },
        data: {
          email,
          firstName: 'Closed',
          middleName: null,
          lastName: 'Account',
          mobileNumber,
          passwordHash,
          emailVerifiedAt: null,
          lastLoginAt: null,
        },
      });
      minimized += result.count;
    }

    return minimized;
  }

  private tombstoneSuffix(userId: string): string {
    return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 20);
  }

  private validateBatchSize(batchSize: number): void {
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        `batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
      );
    }
  }
}
