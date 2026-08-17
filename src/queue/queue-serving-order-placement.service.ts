import { ConflictException, Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  Prisma,
  WaitingPlacementType,
} from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

type WaitingRow = {
  id: string;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  queueNumber: number;
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
    const candidate = this.midpointForInsertion(waiting, insertionIndex);

    if (candidate) {
      return candidate;
    }

    await this.rebalanceWaitingRows(transaction, waiting);
    return new Prisma.Decimal(insertionIndex + 0.5);
  }

  private async lockWaitingRows(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<WaitingRow[]> {
    return transaction.$queryRaw<WaitingRow[]>(Prisma.sql`
      SELECT
        "id",
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
        'Current WAITING order is incomplete and cannot accept a return.',
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

  private midpointForInsertion(
    waiting: WaitingRow[],
    insertionIndex: number,
  ): Prisma.Decimal | null {
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
