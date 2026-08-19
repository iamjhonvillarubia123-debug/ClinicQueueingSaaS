import { Injectable } from '@nestjs/common';
import { Prisma, ScheduledReminderStatus } from '../../generated/prisma/client';
import { ScheduledReminderCancellationService } from '../notification/scheduled-reminder-cancellation.service';
import { PrismaService } from '../prisma/prisma.service';
import { PatientBookingAccessService } from './patient-booking-access.service';

@Injectable()
export class ContactPreferenceWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientBookingAccess: PatientBookingAccessService,
    private readonly reminderCancellation: ScheduledReminderCancellationService,
  ) {}

  async withdraw(
    bookingReference: string,
    rawToken: string,
    now = new Date(),
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.patientBookingAccess.validateManagementToken(
        transaction,
        rawToken,
        bookingReference,
      );

      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          allowFollowUpReminder: boolean;
          withdrawnAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT "id", "allowFollowUpReminder", "withdrawnAt"
        FROM "ContactPreference"
        WHERE "appointmentId" = ${access.appointment.id}
        LIMIT 1
        FOR UPDATE
      `);

      const preference = rows[0];
      if (!preference) {
        return this.fail();
      }

      if (preference.withdrawnAt) {
        return {
          withdrawnAt: preference.withdrawnAt,
          replayed: true,
          cancelledReminderCount: 0,
          reconciliationRequired: false,
        };
      }

      await transaction.contactPreference.update({
        where: { id: preference.id },
        data: { withdrawnAt: now },
      });

      const reminders = await transaction.scheduledReminder.findMany({
        where: {
          contactPreferenceId: preference.id,
          status: {
            in: [
              ScheduledReminderStatus.SCHEDULED,
              ScheduledReminderStatus.PROCESSING,
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      let cancelledReminderCount = 0;
      let reconciliationRequired = false;

      for (const reminder of reminders) {
        const result =
          await this.reminderCancellation.cancelSafelyInTransaction(
            transaction,
            reminder.id,
            now,
          );
        if (result.reconciliationRequired) {
          reconciliationRequired = true;
        } else if (result.reminderStatus === ScheduledReminderStatus.CANCELLED) {
          cancelledReminderCount += 1;
        }
      }

      return {
        withdrawnAt: now,
        replayed: false,
        cancelledReminderCount,
        reconciliationRequired,
      };
    });
  }

  private fail(): never {
    throw new Error('Contact preference is unavailable.');
  }
}
