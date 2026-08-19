import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type LockedFinancialAccount = {
  id: string;
  doctorUserId: string;
};

@Injectable()
export class FinancialAccountLockService {
  async lockById(
    transaction: Prisma.TransactionClient,
    doctorFinancialAccountId: string,
  ): Promise<LockedFinancialAccount> {
    const normalizedId = doctorFinancialAccountId.trim();
    if (!normalizedId) {
      throw new BadRequestException('Financial account identity is required.');
    }

    const rows = await transaction.$queryRaw<LockedFinancialAccount[]>(
      Prisma.sql`
        SELECT "id", "doctorUserId"
        FROM "DoctorFinancialAccount"
        WHERE "id" = ${normalizedId}
        FOR UPDATE
      `,
    );

    const account = rows[0];
    if (!account) {
      throw new NotFoundException('Financial account was not found.');
    }

    return account;
  }

  async lockPair(
    transaction: Prisma.TransactionClient,
    firstDoctorFinancialAccountId: string,
    secondDoctorFinancialAccountId: string,
  ): Promise<[LockedFinancialAccount, LockedFinancialAccount]> {
    const firstId = firstDoctorFinancialAccountId.trim();
    const secondId = secondDoctorFinancialAccountId.trim();

    if (!firstId || !secondId) {
      throw new BadRequestException(
        'Both financial account identities are required.',
      );
    }
    if (firstId === secondId) {
      throw new BadRequestException(
        'Financial transfer source and target must be different accounts.',
      );
    }

    const orderedIds = [firstId, secondId].sort((left, right) =>
      left.localeCompare(right),
    );
    const lockedById = new Map<string, LockedFinancialAccount>();

    for (const accountId of orderedIds) {
      const locked = await this.lockById(transaction, accountId);
      lockedById.set(locked.id, locked);
    }

    const first = lockedById.get(firstId);
    const second = lockedById.get(secondId);
    if (!first || !second) {
      throw new NotFoundException('Financial account was not found.');
    }

    return [first, second];
  }
}
