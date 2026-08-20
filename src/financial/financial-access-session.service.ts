import { createHash, randomBytes } from 'crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserAccountStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SESSION_TTL_MS = 30 * 60 * 1000;

export type FinancialAccessSessionAuthority = {
  financialAccessSessionId: string;
  doctorFinancialAccountId: string;
};

@Injectable()
export class FinancialAccessSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async issueFromVerifiedChallenge(
    challengeId: string,
    doctorFinancialAccountId: string,
    now = new Date(),
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    const session = await this.prisma.$transaction(async (transaction) => {
      const challengeRows = await transaction.$queryRaw<
        Array<{
          id: string;
          recoveryEmailHash: string;
          expiresAt: Date;
          verifiedAt: Date | null;
          consumedAt: Date | null;
          invalidatedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "recoveryEmailHash",
          "expiresAt",
          "verifiedAt",
          "consumedAt",
          "invalidatedAt"
        FROM "FinancialAccessChallenge"
        WHERE "id" = ${challengeId}
        FOR UPDATE
      `);
      const challenge = challengeRows[0];
      if (
        !challenge ||
        !challenge.verifiedAt ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        challenge.expiresAt.getTime() <= now.getTime()
      ) {
        throw new UnauthorizedException(
          'Financial access challenge is unavailable.',
        );
      }

      const accountRows = await transaction.$queryRaw<
        Array<{
          id: string;
          recoveryEmailHash: string | null;
          accountStatus: UserAccountStatus;
        }>
      >(Prisma.sql`
        SELECT
          dfa."id",
          dfa."recoveryEmailHash",
          u."accountStatus"
        FROM "DoctorFinancialAccount" dfa
        JOIN "User" u ON u."id" = dfa."doctorUserId"
        WHERE dfa."id" = ${doctorFinancialAccountId}
        FOR UPDATE OF dfa
      `);
      const account = accountRows[0];
      if (
        !account ||
        account.accountStatus !== UserAccountStatus.PERMANENTLY_CLOSED ||
        !account.recoveryEmailHash ||
        account.recoveryEmailHash !== challenge.recoveryEmailHash
      ) {
        throw new UnauthorizedException(
          'Financial account is unavailable for this verified challenge.',
        );
      }

      const consumed = await transaction.financialAccessChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new ConflictException(
          'Financial access challenge was already consumed.',
        );
      }

      return transaction.financialAccessSession.create({
        data: {
          doctorFinancialAccountId: account.id,
          sourceChallengeId: challenge.id,
          tokenHash,
          expiresAt,
          createdAt: now,
        },
        select: {
          id: true,
          doctorFinancialAccountId: true,
          expiresAt: true,
        },
      });
    });

    return { rawToken, session };
  }

  async authorize(
    rawToken: string,
    expectedDoctorFinancialAccountId?: string,
    now = new Date(),
  ): Promise<FinancialAccessSessionAuthority> {
    const normalizedToken = rawToken.trim();
    if (!normalizedToken) {
      throw new UnauthorizedException('Financial access session is invalid.');
    }

    const tokenHash = this.hashToken(normalizedToken);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          doctorFinancialAccountId: string;
          expiresAt: Date;
          revokedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "doctorFinancialAccountId",
          "expiresAt",
          "revokedAt"
        FROM "FinancialAccessSession"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `);
      const session = rows[0];
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= now.getTime() ||
        (expectedDoctorFinancialAccountId !== undefined &&
          session.doctorFinancialAccountId !== expectedDoctorFinancialAccountId)
      ) {
        throw new UnauthorizedException('Financial access session is invalid.');
      }

      await transaction.financialAccessSession.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });

      return {
        financialAccessSessionId: session.id,
        doctorFinancialAccountId: session.doctorFinancialAccountId,
      };
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
}
