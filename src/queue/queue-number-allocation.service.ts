import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class QueueNumberAllocationService {
  async allocateNext(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<number> {
    const normalizedServiceDate = this.normalizeServiceDate(serviceDate);
    const lockKey = `QUEUE_COUNTER:${practiceLocationId}:${normalizedServiceDate}`;

    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);

    const dateValue = new Date(`${normalizedServiceDate}T00:00:00.000Z`);
    const [existingCounter, highestCommittedQueueNumber] = await Promise.all([
      transaction.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate: dateValue,
          },
        },
        select: { lastAllocatedNumber: true },
      }),
      transaction.appointment.aggregate({
        where: { practiceLocationId, serviceDate: dateValue },
        _max: { queueNumber: true },
      }),
    ]);

    const highestQueueNumber =
      highestCommittedQueueNumber._max.queueNumber ?? 0;
    const currentCounter = existingCounter?.lastAllocatedNumber ?? 0;

    if (currentCounter < highestQueueNumber) {
      throw new InternalServerErrorException(
        'Queue allocation state is inconsistent and requires review.',
      );
    }

    const counter = await transaction.queueCounter.upsert({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue,
        },
      },
      create: {
        practiceLocationId,
        serviceDate: dateValue,
        lastAllocatedNumber: 1,
      },
      update: {
        lastAllocatedNumber: { increment: 1 },
      },
      select: { lastAllocatedNumber: true },
    });

    return counter.lastAllocatedNumber;
  }

  private normalizeServiceDate(serviceDate: Date): string {
    if (!(serviceDate instanceof Date) || Number.isNaN(serviceDate.getTime())) {
      throw new InternalServerErrorException(
        'Queue allocation requires a valid Service Date.',
      );
    }

    return serviceDate.toISOString().slice(0, 10);
  }
}
