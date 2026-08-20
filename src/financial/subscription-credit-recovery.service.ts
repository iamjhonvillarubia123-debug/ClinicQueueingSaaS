import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  Prisma,
  SubscriptionCreditEntryType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccessSessionService } from './financial-access-session.service';
import { FinancialAccountLockService } from './financial-account-lock.service';
import { SubscriptionCreditBalanceService } from './subscription-credit-balance.service';

type RecoverSubscriptionCreditInput = {
  authenticatedUserId: string;
  historicalDoctorFinancialAccountId: string;
  financialAccessToken: string;
  idempotencyKey: string | undefined;
  recoveredAt?: Date;
};

@Injectable()
export class SubscriptionCreditRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialAccess: FinancialAccessSessionService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly accountLocks: FinancialAccountLockService,
    private readonly creditBalance: SubscriptionCreditBalanceService,
  ) {}

  async recover(input: RecoverSubscriptionCreditInput) {
    const sourceFinancialAccountId =
      input.historicalDoctorFinancialAccountId.trim();
    if (!sourceFinancialAccountId) {
      throw new BadRequestException(
        'Historical financial account identity is required.',
      );
    }

    await this.financialAccess.authorize(
      input.financialAccessToken,
      sourceFinancialAccountId,
    );

    const idempotencyKey = this.idempotency.normalizeKey(input.idempotencyKey);
    const recoveredAt = input.recoveredAt ?? new Date();
    const requestFingerprint = this.idempotency.fingerprint({
      sourceDoctorFinancialAccountId: sourceFinancialAccountId,
      targetDoctorUserId: input.authenticatedUserId,
    });

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`doctor-financial-account:${input.authenticatedUserId}`},
            0
          )
        )
      `);

      const targetUser = await transaction.user.findUnique({
        where: { id: input.authenticatedUserId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
        },
      });
      if (
        !targetUser ||
        targetUser.role !== UserRole.DOCTOR ||
        targetUser.accountStatus !== UserAccountStatus.ACTIVE ||
        targetUser.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE
      ) {
        throw new ForbiddenException(
          'Only a current eligible Doctor may recover historical subscription credit.',
        );
      }

      let targetFinancialAccount =
        await transaction.doctorFinancialAccount.findUnique({
          where: { doctorUserId: targetUser.id },
          select: { id: true, doctorUserId: true },
        });
      if (!targetFinancialAccount) {
        targetFinancialAccount = await transaction.doctorFinancialAccount.create({
          data: { doctorUserId: targetUser.id },
          select: { id: true, doctorUserId: true },
        });
      }
      if (targetFinancialAccount.id === sourceFinancialAccountId) {
        throw new BadRequestException(
          'Historical credit recovery requires a different target financial account.',
        );
      }

      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey,
        commandType: CommandType.DOCTOR_RECOVER_SUBSCRIPTION_CREDIT,
        scope: {
          actorUserId: targetUser.id,
          doctorFinancialAccountId: sourceFinancialAccountId,
          targetDoctorFinancialAccountId: targetFinancialAccount.id,
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
        const entries = await transaction.subscriptionCreditEntry.findMany({
          where: {
            commandIdempotencyId: replay.id,
            entryType: {
              in: [
                SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
                SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
              ],
            },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        });
        const transferOut = entries.find(
          (entry) =>
            entry.entryType ===
            SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
        );
        const transferIn = entries.find(
          (entry) =>
            entry.entryType === SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
        );
        if (
          !transferOut ||
          !transferIn ||
          transferOut.doctorFinancialAccountId !== sourceFinancialAccountId ||
          transferIn.doctorFinancialAccountId !== targetFinancialAccount.id ||
          !transferOut.amount.equals(transferIn.amount)
        ) {
          throw new InternalServerErrorException(
            'Committed subscription credit recovery result is unavailable.',
          );
        }
        return {
          sourceDoctorFinancialAccountId: sourceFinancialAccountId,
          targetDoctorFinancialAccountId: targetFinancialAccount.id,
          recoveredAmount: transferOut.amount.toFixed(2),
          replayed: true,
        };
      }

      const [lockedSource, lockedTarget] = await this.accountLocks.lockPair(
        transaction,
        sourceFinancialAccountId,
        targetFinancialAccount.id,
      );
      if (lockedTarget.doctorUserId !== targetUser.id) {
        throw new InternalServerErrorException(
          'Target Doctor financial account ownership is inconsistent.',
        );
      }

      const sourceOwner = await transaction.user.findUnique({
        where: { id: lockedSource.doctorUserId },
        select: { accountStatus: true },
      });
      if (
        !sourceOwner ||
        sourceOwner.accountStatus !== UserAccountStatus.PERMANENTLY_CLOSED
      ) {
        throw new ForbiddenException(
          'Historical subscription credit source is unavailable for recovery.',
        );
      }

      const sourceBalance = await this.creditBalance.derive(
        transaction,
        sourceFinancialAccountId,
      );
      const recoveredAmount = new Prisma.Decimal(sourceBalance.available);
      if (!recoveredAmount.greaterThan(0)) {
        throw new BadRequestException(
          'No eligible historical subscription credit is available for recovery.',
        );
      }

      const times = this.idempotency.completionTimes(recoveredAt);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey,
          commandIdentityKey,
          commandType: CommandType.DOCTOR_RECOVER_SUBSCRIPTION_CREDIT,
          requestFingerprint,
          actorUserId: targetUser.id,
          accountUserId: targetUser.id,
          doctorFinancialAccountId: sourceFinancialAccountId,
          completedAt: times.completedAt,
          expiresAt: times.expiresAt,
          createdAt: times.completedAt,
        },
        select: { id: true },
      });

      const transferOut = await transaction.subscriptionCreditEntry.create({
        data: {
          doctorFinancialAccountId: sourceFinancialAccountId,
          entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_OUT,
          amount: recoveredAmount,
          commandIdempotencyId: command.id,
          occurredAt: recoveredAt,
        },
        select: { id: true },
      });
      await transaction.subscriptionCreditEntry.create({
        data: {
          doctorFinancialAccountId: targetFinancialAccount.id,
          entryType: SubscriptionCreditEntryType.RECOVERY_TRANSFER_IN,
          amount: recoveredAmount,
          relatedCreditEntryId: transferOut.id,
          commandIdempotencyId: command.id,
          occurredAt: recoveredAt,
        },
      });

      return {
        sourceDoctorFinancialAccountId: sourceFinancialAccountId,
        targetDoctorFinancialAccountId: targetFinancialAccount.id,
        recoveredAmount: recoveredAmount.toFixed(2),
        replayed: false,
      };
    });
  }
}
