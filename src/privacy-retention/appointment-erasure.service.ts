import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  Prisma,
  PrivacyErasureResourceType,
  RetentionResourceType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const APPOINTMENT_ERASURE_DELAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_REPLAY_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

type LockedAppointment = {
  id: string;
  practiceLocationId: string;
  bookingGroupId: string | null;
  serviceDate: Date;
  status: AppointmentStatus;
  terminalAt: Date | null;
};

type AnalyticsContribution = {
  bookedCount: number;
  servedCount: number;
  cancelledCount: number;
  absenceCount: number;
};

export type AppointmentErasureResult = {
  appointmentId: string;
  outcome: 'ERASED' | 'ALREADY_ERASED';
  erasureCommittedAt: Date;
};

@Injectable()
export class AppointmentErasureService {
  constructor(private readonly prisma: PrismaService) {}

  async eraseEligibleAppointment(
    appointmentId: string,
    now = new Date(),
  ): Promise<AppointmentErasureResult> {
    const normalizedAppointmentId = appointmentId.trim();
    if (!normalizedAppointmentId) {
      throw new NotFoundException('Appointment not found.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const existingLedger = await this.findLedger(
        transaction,
        normalizedAppointmentId,
      );
      if (existingLedger) {
        return {
          appointmentId: normalizedAppointmentId,
          outcome: 'ALREADY_ERASED' as const,
          erasureCommittedAt: existingLedger.erasureCommittedAt,
        };
      }

      const appointment = await this.lockAppointment(
        transaction,
        normalizedAppointmentId,
      );
      if (!appointment) {
        const committedLedger = await this.findLedger(
          transaction,
          normalizedAppointmentId,
        );
        if (committedLedger) {
          return {
            appointmentId: normalizedAppointmentId,
            outcome: 'ALREADY_ERASED' as const,
            erasureCommittedAt: committedLedger.erasureCommittedAt,
          };
        }
        throw new NotFoundException('Appointment not found.');
      }

      this.assertErasureWindowReached(appointment, now);
      await this.assertNoActiveRetentionHold(
        transaction,
        normalizedAppointmentId,
        now,
      );

      const contribution = this.calculateAnalyticsContribution(appointment);

      await transaction.queueAnalyticsDaily.upsert({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: appointment.practiceLocationId,
            serviceDate: appointment.serviceDate,
          },
        },
        create: {
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          ...contribution,
        },
        update: {
          bookedCount: { increment: contribution.bookedCount },
          servedCount: { increment: contribution.servedCount },
          cancelledCount: { increment: contribution.cancelledCount },
          absenceCount: { increment: contribution.absenceCount },
        },
      });

      const ledger = await transaction.privacyErasureLedger.create({
        data: {
          resourceType: PrivacyErasureResourceType.APPOINTMENT,
          resourceId: normalizedAppointmentId,
          erasureCommittedAt: now,
          backupReplayUntil: new Date(now.getTime() + BACKUP_REPLAY_WINDOW_MS),
          createdAt: now,
        },
        select: { erasureCommittedAt: true },
      });

      await this.unlinkAppointmentDependencies(transaction, appointment, now);

      await transaction.appointment.delete({
        where: { id: normalizedAppointmentId },
      });

      if (appointment.bookingGroupId) {
        await this.cleanupEmptyBookingGroup(
          transaction,
          appointment.bookingGroupId,
          now,
        );
      }

      return {
        appointmentId: normalizedAppointmentId,
        outcome: 'ERASED' as const,
        erasureCommittedAt: ledger.erasureCommittedAt,
      };
    });
  }

  private async findLedger(
    transaction: Prisma.TransactionClient,
    appointmentId: string,
  ) {
    return transaction.privacyErasureLedger.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: PrivacyErasureResourceType.APPOINTMENT,
          resourceId: appointmentId,
        },
      },
      select: { erasureCommittedAt: true },
    });
  }

  private async lockAppointment(
    transaction: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<LockedAppointment | null> {
    const rows = await transaction.$queryRaw<LockedAppointment[]>(
      Prisma.sql`
        SELECT
          "id",
          "practiceLocationId",
          "bookingGroupId",
          "serviceDate",
          "status",
          "terminalAt"
        FROM "Appointment"
        WHERE "id" = ${appointmentId}
        FOR UPDATE
      `,
    );

    return rows[0] ?? null;
  }

  private assertErasureWindowReached(
    appointment: LockedAppointment,
    now: Date,
  ): void {
    if (!appointment.terminalAt || !this.isTerminalStatus(appointment.status)) {
      throw new ConflictException('Appointment is not terminal.');
    }

    const eligibleAt =
      appointment.terminalAt.getTime() + APPOINTMENT_ERASURE_DELAY_MS;
    if (now.getTime() < eligibleAt) {
      throw new ConflictException(
        'Appointment retention window has not ended.',
      );
    }
  }

  private async assertNoActiveRetentionHold(
    transaction: Prisma.TransactionClient,
    appointmentId: string,
    now: Date,
  ): Promise<void> {
    const activeHold = await transaction.retentionHold.findFirst({
      where: {
        resourceType: RetentionResourceType.APPOINTMENT,
        resourceId: appointmentId,
        releasedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });

    if (activeHold) {
      throw new ConflictException(
        'Appointment is protected by an active retention hold.',
      );
    }
  }

  private calculateAnalyticsContribution(
    appointment: LockedAppointment,
  ): AnalyticsContribution {
    return {
      bookedCount: 1,
      servedCount: appointment.status === AppointmentStatus.COMPLETED ? 1 : 0,
      cancelledCount:
        appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.RESCHEDULED
          ? 1
          : 0,
      absenceCount:
        appointment.status === AppointmentStatus.EXPIRED ||
        appointment.status === AppointmentStatus.NO_SHOW
          ? 1
          : 0,
    };
  }

  private async unlinkAppointmentDependencies(
    transaction: Prisma.TransactionClient,
    appointment: LockedAppointment,
    now: Date,
  ): Promise<void> {
    await transaction.bookingRecoveryAttempt.updateMany({
      where: { candidateAppointmentId: appointment.id },
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
        OR: [
          { appointmentId: appointment.id },
          { resultAppointmentId: appointment.id },
        ],
      },
      data: {
        appointmentId: null,
        resultAppointmentId: null,
      },
    });

    await transaction.scheduledReminder.updateMany({
      where: { sourceAppointmentId: appointment.id },
      data: { sourceAppointmentId: null },
    });

    await transaction.contactPreference.updateMany({
      where: { appointmentId: appointment.id },
      data: { appointmentId: null },
    });

    const directOutboxes = await transaction.notificationOutbox.findMany({
      where: {
        appointmentId: appointment.id,
        scheduledReminderId: null,
      },
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
      where: {
        appointmentId: appointment.id,
        scheduledReminderId: { not: null },
      },
      data: { appointmentId: null },
    });

    await transaction.appointmentAnswer.deleteMany({
      where: { appointmentId: appointment.id },
    });
    await transaction.queueEventAppointmentLink.deleteMany({
      where: { appointmentId: appointment.id },
    });
    await transaction.bookingAccessToken.deleteMany({
      where: { appointmentId: appointment.id },
    });
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
      data: {
        bookingGroupId: null,
        resultBookingGroupId: null,
      },
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
    await transaction.bookingGroup.delete({
      where: { id: bookingGroupId },
    });
  }

  private isTerminalStatus(status: AppointmentStatus): boolean {
    const terminalStatuses: AppointmentStatus[] = [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.RESCHEDULED,
    ];

    return terminalStatuses.includes(status);
  }
}
