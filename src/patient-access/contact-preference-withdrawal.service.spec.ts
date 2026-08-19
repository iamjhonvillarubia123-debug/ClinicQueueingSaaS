import { UnauthorizedException } from '@nestjs/common';
import { ScheduledReminderStatus } from '../../generated/prisma/client';
import { ContactPreferenceWithdrawalService } from './contact-preference-withdrawal.service';

describe('ContactPreferenceWithdrawalService', () => {
  function createFixture() {
    const transaction = {
      $queryRaw: jest.fn(),
      contactPreference: { update: jest.fn() },
      scheduledReminder: { findMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const patientBookingAccess = {
      validateManagementToken: jest.fn().mockResolvedValue({
        appointment: { id: 'appointment-1' },
      }),
    };
    const reminderCancellation = {
      cancelSafelyInTransaction: jest.fn(),
    };
    const service = new ContactPreferenceWithdrawalService(
      prisma as never,
      patientBookingAccess as never,
      reminderCancellation as never,
    );
    return {
      service,
      transaction,
      patientBookingAccess,
      reminderCancellation,
    };
  }

  it('withdraws once and cancels every eligible unsent reminder atomically', async () => {
    const fixture = createFixture();
    const now = new Date('2026-08-19T12:00:00.000Z');
    fixture.transaction.$queryRaw.mockResolvedValue([
      {
        id: 'preference-1',
        allowFollowUpReminder: true,
        withdrawnAt: null,
      },
    ]);
    fixture.transaction.scheduledReminder.findMany.mockResolvedValue([
      { id: 'reminder-1' },
      { id: 'reminder-2' },
    ]);
    fixture.reminderCancellation.cancelSafelyInTransaction
      .mockResolvedValueOnce({
        reminderStatus: ScheduledReminderStatus.CANCELLED,
        outboxStatus: null,
        reconciliationRequired: false,
      })
      .mockResolvedValueOnce({
        reminderStatus: ScheduledReminderStatus.PROCESSING,
        outboxStatus: 'PROCESSING',
        reconciliationRequired: true,
      });

    await expect(
      fixture.service.withdraw('BOOK-1', 'valid-token', now),
    ).resolves.toEqual({
      withdrawnAt: now,
      replayed: false,
      cancelledReminderCount: 1,
      reconciliationRequired: true,
    });
    expect(fixture.transaction.contactPreference.update).toHaveBeenCalledWith({
      where: { id: 'preference-1' },
      data: { withdrawnAt: now },
    });
    expect(
      fixture.reminderCancellation.cancelSafelyInTransaction,
    ).toHaveBeenCalledTimes(2);
  });

  it('returns the original withdrawal timestamp on repeated withdrawal without recancelling reminders', async () => {
    const fixture = createFixture();
    const withdrawnAt = new Date('2026-08-19T11:00:00.000Z');
    fixture.transaction.$queryRaw.mockResolvedValue([
      {
        id: 'preference-1',
        allowFollowUpReminder: true,
        withdrawnAt,
      },
    ]);

    await expect(
      fixture.service.withdraw('BOOK-1', 'valid-token'),
    ).resolves.toEqual({
      withdrawnAt,
      replayed: true,
      cancelledReminderCount: 0,
      reconciliationRequired: false,
    });
    expect(fixture.transaction.contactPreference.update).not.toHaveBeenCalled();
    expect(
      fixture.transaction.scheduledReminder.findMany,
    ).not.toHaveBeenCalled();
  });

  it('requires a management token scoped to the same Appointment', async () => {
    const fixture = createFixture();
    fixture.patientBookingAccess.validateManagementToken.mockRejectedValue(
      new UnauthorizedException('Patient booking access is unavailable.'),
    );

    await expect(
      fixture.service.withdraw('BOOK-OTHER', 'wrong-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fixture.transaction.$queryRaw).not.toHaveBeenCalled();
  });
});
