import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  PrivacyErasureResourceType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

type LockedAppointment = {
  id: string;
  bookingGroupId: string | null;
};

export type BackupErasureReplayResult = {
  ledgersProcessed: number;
  appointmentsReplayed: number;
  alreadyAbsent: number;
};

@Injectable()
export class BackupErasureReplayService {
  constructor(private readonly prisma: PrismaService) {}

  async replayLoadedLedgers(
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<BackupErasureReplayResult> {
    this.assertBatchSize(batchSize);

    const ledgers = await this.prisma.privacyErasureLedger.findMany({
      where: {
        resourceType: PrivacyErasureResourceType.APPOINTMENT,
        backupReplayUntil: { gte: now },
      },
      orderBy: [{ erasureCommittedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
      select: { resourceId: true },
    });

    let appointmentsReplayed = 0;
    let alreadyAbsent = 0;

    for (const ledger of ledgers) {
      const replayed = await this.prisma.$transaction(async (transaction) =>
        this.replayAppointment(transaction, ledger.resourceId, now),
      );
      if (replayed) appointmentsReplayed += 1;
      else alreadyAbsent += 1;
    }

    return {
      ledgersProcessed: ledgers.length,
      appointmentsReplayed,
      alreadyAbsent,
    };
  }

  private async replayAppointment(
    transaction: Prisma.TransactionClient,
    appointmentId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<LockedAppointment[]>(Prisma.sql`
      SELECT "id", "bookingGroupId"
      FROM "Appointment"
      WHERE "id" = ${appointmentId}
      FOR UPDATE
    `);
    const appointment = rows[0] ?? null;

    await transaction.bookingRecoveryAttempt.updateMany({
      where: { candidateAppointmentId: appointmentId },
      data: {
        candidateAppointmentId: null,
        mobileNumberEncrypted: null,
        mobileNumberHash: null,
        mobileHashKeyVersion: null,
        mobileNumberLastFour: null,
        protectedDataClearedAt: now,
      },
    });

    await transaction.commandIdempotency.updateMany({
      where: {
        OR: [{ appointmentId }, { resultAppointmentId: appointmentId }],
      },
      data: { appointmentId: null, resultAppointmentId: null },
    });

    await transaction.scheduledReminder.updateMany({
      where: { sourceAppointmentId: appointmentId },
      data: { sourceAppointmentId: null },
    });
    await transaction.contactPreference.updateMany({
      where: { appointmentId },
      data: { appointmentId: null },
    });

    const directOutboxes = await transaction.notificationOutbox.findMany({
      where: { appointmentId, scheduledReminderId: null },
      select: { id: true },
    });
    const directOutboxIds = directOutboxes.map((outbox) => outbox.id);
    if (directOutboxIds.length > 0) {
      await transaction.notificationLog.deleteMany({
        where: { notificationOutboxId: { in: directOutboxIds } },
      });
      await transaction.notificationOutbox.deleteMany({
        where: { id: { in: directOutboxIds } },
      });
    }

    await transaction.notificationOutbox.updateMany({
      where: { appointmentId, scheduledReminderId: { not: null } },
      data: { appointmentId: null },
    });
    await transaction.appointmentAnswer.deleteMany({
      where: { appointmentId },
    });
    await transaction.queueEventAppointmentLink.deleteMany({
      where: { appointmentId },
    });
    await transaction.bookingAccessToken.deleteMany({
      where: { appointmentId },
    });

    if (appointment) {
      await transaction.appointment.delete({ where: { id: appointmentId } });
      if (appointment.bookingGroupId) {
        await this.cleanupEmptyBookingGroup(
          transaction,
          appointment.bookingGroupId,
          now,
        );
      }
    }

    await this.assertAppointmentCorrelationAbsent(transaction, appointmentId);
    return appointment !== null;
  }

  private async cleanupEmptyBookingGroup(
    transaction: Prisma.TransactionClient,
    bookingGroupId: string,
    now: Date,
  ): Promise<void> {
    const remainingAppointments = await transaction.appointment.count({
      where: { bookingGroupId },
    });
    if (remainingAppointments > 0) return;

    await transaction.bookingGroupRecoveryAttempt.updateMany({
      where: { bookingGroupId },
      data: {
        bookingGroupId: null,
        mobileNumberEncrypted: null,
        mobileNumberHash: null,
        mobileHashKeyVersion: null,
        mobileNumberLastFour: null,
        protectedDataClearedAt: now,
      },
    });
    await transaction.commandIdempotency.updateMany({
      where: {
        OR: [{ bookingGroupId }, { resultBookingGroupId: bookingGroupId }],
      },
      data: { bookingGroupId: null, resultBookingGroupId: null },
    });

    const groupOutboxes = await transaction.notificationOutbox.findMany({
      where: { bookingGroupId },
      select: { id: true },
    });
    const groupOutboxIds = groupOutboxes.map((outbox) => outbox.id);
    if (groupOutboxIds.length > 0) {
      await transaction.notificationLog.deleteMany({
        where: { notificationOutboxId: { in: groupOutboxIds } },
      });
      await transaction.notificationOutbox.deleteMany({
        where: { id: { in: groupOutboxIds } },
      });
    }

    await transaction.bookingGroupAccessToken.deleteMany({
      where: { bookingGroupId },
    });
    await transaction.bookingGroup.delete({ where: { id: bookingGroupId } });
  }

  private async assertAppointmentCorrelationAbsent(
    transaction: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<void> {
    const [
      appointments,
      answers,
      queueLinks,
      accessTokens,
      recoveryLinks,
      commandLinks,
      reminderLinks,
      contactLinks,
      outboxLinks,
    ] = await Promise.all([
      transaction.appointment.count({ where: { id: appointmentId } }),
      transaction.appointmentAnswer.count({ where: { appointmentId } }),
      transaction.queueEventAppointmentLink.count({ where: { appointmentId } }),
      transaction.bookingAccessToken.count({ where: { appointmentId } }),
      transaction.bookingRecoveryAttempt.count({
        where: { candidateAppointmentId: appointmentId },
      }),
      transaction.commandIdempotency.count({
        where: {
          OR: [{ appointmentId }, { resultAppointmentId: appointmentId }],
        },
      }),
      transaction.scheduledReminder.count({
        where: { sourceAppointmentId: appointmentId },
      }),
      transaction.contactPreference.count({ where: { appointmentId } }),
      transaction.notificationOutbox.count({ where: { appointmentId } }),
    ]);

    const residualCount =
      appointments +
      answers +
      queueLinks +
      accessTokens +
      recoveryLinks +
      commandLinks +
      reminderLinks +
      contactLinks +
      outboxLinks;

    if (residualCount !== 0) {
      throw new ConflictException(
        'Backup erasure replay verification found residual Appointment correlation.',
      );
    }
  }

  private assertBatchSize(batchSize: number): void {
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new BadRequestException(
        'Backup erasure replay batch size is invalid.',
      );
    }
  }
}
