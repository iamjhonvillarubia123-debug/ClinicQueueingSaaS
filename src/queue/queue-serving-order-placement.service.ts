import { ConflictException, Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  Prisma,
  WaitingPlacementType,
} from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

type WaitingRow = {
  id: string;
  bookingGroupId: string | null;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  queueNumber: number;
};

type StaffReinsertTarget = {
  id: string;
  bookingGroupId: string | null;
  status: AppointmentStatus;
  waitingPlacementType: WaitingPlacementType | null;
};

@Injectable()
export class QueueServingOrderPlacementService {
  async calculateReturnToQueuePlacement(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<Prisma.Decimal> {
    const waiting = await this.lockWaitingRows(
      transaction,
      practiceLocationId,
      serviceDate,
    );

    if (waiting.length === 0) {
      return new Prisma.Decimal(1);
    }

    this.assertValidWaitingRows(waiting);
    const insertionIndex = this.returnToQueueInsertionIndex(waiting);
    return this.keyForInsertion(transaction, waiting, insertionIndex);
  }

  async calculateStaffReinsertPlacement(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
    target: StaffReinsertTarget,
    afterAppointmentId?: string,
  ): Promise<Prisma.Decimal> {
    const lockedWaiting = await this.lockWaitingRows(
      transaction,
      practiceLocationId,
      serviceDate,
    );
    this.assertValidWaitingRows(lockedWaiting);

    const targetIndex = lockedWaiting.findIndex((row) => row.id === target.id);
    if (target.status === AppointmentStatus.WAITING && targetIndex === 0) {
      throw new ConflictException('Protected Next cannot be repositioned.');
    }
    if (
      target.status === AppointmentStatus.WAITING &&
      target.waitingPlacementType === WaitingPlacementType.RETURN_TO_QUEUE
    ) {
      throw new ConflictException(
        'Protected RETURN TO QUEUE placement cannot be moved by Staff Reinsert.',
      );
    }

    const waiting = lockedWaiting.filter((row) => row.id !== target.id);
    if (waiting.length === 0) {
      return new Prisma.Decimal(1);
    }

    const minimumIndex = this.recoveryAreaStartIndex(waiting);
    const groupTailIndex = await this.activeGroupTailInsertionIndex(
      transaction,
      waiting,
      target.bookingGroupId,
    );
    let insertionIndex: number;

    if (groupTailIndex !== null) {
      insertionIndex = Math.max(minimumIndex, groupTailIndex);
    } else if (afterAppointmentId) {
      const neighborIndex = waiting.findIndex(
        (row) => row.id === afterAppointmentId,
      );
      if (neighborIndex < 0) {
        throw new ConflictException(
          'Selected Staff Reinsert placement is stale or unavailable.',
        );
      }
      insertionIndex = neighborIndex + 1;
      if (insertionIndex < minimumIndex) {
        throw new ConflictException(
          'Staff Reinsert cannot displace protected queue positions.',
        );
      }
      insertionIndex = await this.movePastActiveGroupIfNeeded(
        transaction,
        waiting,
        insertionIndex,
      );
    } else {
      insertionIndex = minimumIndex;
      insertionIndex = await this.movePastActiveGroupIfNeeded(
        transaction,
        waiting,
        insertionIndex,
      );
    }

    return this.keyForInsertion(transaction, waiting, insertionIndex);
  }

  private async lockWaitingRows(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<WaitingRow[]> {
    return transaction.$queryRaw<WaitingRow[]>(Prisma.sql`
      SELECT
        "id",
        "bookingGroupId",
        "servingOrderKey",
        "waitingPlacementType",
        "queueNumber"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" = ${AppointmentStatus.WAITING}::"AppointmentStatus"
      ORDER BY "servingOrderKey" ASC NULLS LAST, "queueNumber" ASC
      FOR UPDATE
    `);
  }

  private assertValidWaitingRows(waiting: WaitingRow[]): void {
    if (
      waiting.some(
        (row) => !row.servingOrderKey || row.waitingPlacementType === null,
      )
    ) {
      throw new ConflictException(
        'Current WAITING order is incomplete and cannot accept a queue placement.',
      );
    }
  }

  private returnToQueueInsertionIndex(waiting: WaitingRow[]): number {
    let index = 1;
    while (
      index < waiting.length &&
      waiting[index]?.waitingPlacementType ===
        WaitingPlacementType.RETURN_TO_QUEUE
    ) {
      index += 1;
    }
    return index;
  }

  private recoveryAreaStartIndex(waiting: WaitingRow[]): number {
    return this.returnToQueueInsertionIndex(waiting);
  }

  private async activeGroupTailInsertionIndex(
    transaction: TransactionClient,
    waiting: WaitingRow[],
    bookingGroupId: string | null,
  ): Promise<number | null> {
    if (!bookingGroupId) return null;

    const group = await transaction.bookingGroup.findUnique({
      where: { id: bookingGroupId },
      select: { servingProtectionEndedAt: true },
    });
    if (!group || group.servingProtectionEndedAt) return null;

    const groupIndexes = waiting
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.bookingGroupId === bookingGroupId)
      .map(({ index }) => index);
    if (groupIndexes.length === 0) return null;

    return Math.max(...groupIndexes) + 1;
  }

  private async movePastActiveGroupIfNeeded(
    transaction: TransactionClient,
    waiting: WaitingRow[],
    insertionIndex: number,
  ): Promise<number> {
    if (insertionIndex <= 0 || insertionIndex >= waiting.length) {
      return insertionIndex;
    }

    const leftGroupId = waiting[insertionIndex - 1]?.bookingGroupId;
    const rightGroupId = waiting[insertionIndex]?.bookingGroupId;
    if (!leftGroupId || leftGroupId !== rightGroupId) {
      return insertionIndex;
    }

    const group = await transaction.bookingGroup.findUnique({
      where: { id: leftGroupId },
      select: { servingProtectionEndedAt: true },
    });
    if (!group || group.servingProtectionEndedAt) {
      return insertionIndex;
    }

    let index = insertionIndex;
    while (
      index < waiting.length &&
      waiting[index]?.bookingGroupId === leftGroupId
    ) {
      index += 1;
    }
    return index;
  }

  private async keyForInsertion(
    transaction: TransactionClient,
    waiting: WaitingRow[],
    insertionIndex: number,
  ): Promise<Prisma.Decimal> {
    const candidate = this.midpointForInsertion(waiting, insertionIndex);
    if (candidate) return candidate;

    await this.rebalanceWaitingRows(transaction, waiting);
    return new Prisma.Decimal(insertionIndex + 0.5);
  }

  private midpointForInsertion(
    waiting: WaitingRow[],
    insertionIndex: number,
  ): Prisma.Decimal | null {
    if (insertionIndex === 0) {
      const first = waiting[0]?.servingOrderKey;
      if (!first) return new Prisma.Decimal(1);
      return first.minus(1);
    }

    const left = waiting[insertionIndex - 1]?.servingOrderKey;
    if (!left) {
      throw new ConflictException('Protected Next placement is unavailable.');
    }

    const right = waiting[insertionIndex]?.servingOrderKey;
    if (!right) {
      return left.plus(1);
    }

    const minimumGap = new Prisma.Decimal('0.000000000000000001');
    if (right.minus(left).lessThanOrEqualTo(minimumGap)) {
      return null;
    }

    return left.plus(right).dividedBy(2);
  }

  private async rebalanceWaitingRows(
    transaction: TransactionClient,
    waiting: WaitingRow[],
  ): Promise<void> {
    for (const [index, row] of waiting.entries()) {
      await transaction.appointment.update({
        where: { id: row.id },
        data: { servingOrderKey: new Prisma.Decimal(index + 1) },
      });
    }
  }
}
