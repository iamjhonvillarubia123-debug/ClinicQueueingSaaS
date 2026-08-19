import {
  NotificationOutboxStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { NotificationSubmissionBoundaryService } from './notification-submission-boundary.service';

type ReminderRow = {
  id: string;
  practiceLocationId: string;
  contactPreferenceId: string;
  status: ScheduledReminderStatus;
  expiresAt: Date;
};

describe('NotificationSubmissionBoundaryService scheduled reminder revalidation', () => {
  const now = new Date('2026-08-19T14:00:00.000Z');
  const leaseExpiresAt = new Date('2026-08-19T14:05:00.000Z');

  function createService(
    options: {
      attemptCount?: number;
      latestRecordedAttempt?: number;
      reminder?: Partial<ReminderRow>;
      withdrawnAt?: Date | null;
      allowFollowUpReminder?: boolean;
      locationStatus?: PracticeLocationLifecycleStatus;
    } = {},
  ) {
    const reminder: ReminderRow = {
      id: 'reminder-1',
      practiceLocationId: 'location-1',
      contactPreferenceId: 'preference-1',
      status: ScheduledReminderStatus.PROCESSING,
      expiresAt: new Date('2026-08-19T15:00:00.000Z'),
      ...options.reminder,
    };
    const latestRecordedAttempt = options.latestRecordedAttempt ?? 0;
    let rawQueryCount = 0;

    const transaction = {
      $queryRaw: jest.fn(() => {
        rawQueryCount += 1;
        switch (rawQueryCount) {
          case 1:
            return Promise.resolve([
              {
                id: 'outbox-1',
                notificationType: NotificationType.SCHEDULED_REMINDER,
                status: NotificationOutboxStatus.PROCESSING,
                practiceLocationId: 'location-1',
                scheduledReminderId: 'reminder-1',
                otpVerificationId: null,
                attemptCount: options.attemptCount ?? 0,
                processingWorkerId: 'worker-1',
                leaseExpiresAt,
              },
            ]);
          case 2:
            return Promise.resolve([reminder]);
          case 3:
            return Promise.resolve([
              {
                id: 'preference-1',
                withdrawnAt: options.withdrawnAt ?? null,
                allowFollowUpReminder:
                  options.allowFollowUpReminder === undefined
                    ? true
                    : options.allowFollowUpReminder,
              },
            ]);
          case 4:
            return Promise.resolve([
              {
                id: 'location-1',
                lifecycleStatus:
                  options.locationStatus ??
                  PracticeLocationLifecycleStatus.ACTIVE,
              },
            ]);
          default:
            return Promise.resolve([]);
        }
      }),
      notificationLog: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            latestRecordedAttempt > 0
              ? { attemptNumber: latestRecordedAttempt }
              : null,
          ),
        ),
      },
      notificationOutbox: {
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(args),
        ),
      },
      scheduledReminder: {
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    };

    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    return {
      service: new NotificationSubmissionBoundaryService(prisma as never),
      transaction,
    };
  }

  it('reserves first provider attempt when reminder, permission and location remain eligible', async () => {
    const { service, transaction } = createService();

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 1 });

    expect(transaction.notificationOutbox.update).toHaveBeenLastCalledWith({
      where: { id: 'outbox-1' },
      data: { attemptCount: 1 },
    });
    expect(transaction.scheduledReminder.updateMany).not.toHaveBeenCalled();
  });

  it('cancels safely before first submission when reminder permission was withdrawn', async () => {
    const { service, transaction } = createService({
      withdrawnAt: new Date(now.getTime() - 1_000),
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });

    expect(transaction.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: expect.objectContaining({
        status: NotificationOutboxStatus.CANCELLED,
        cancelledAt: now,
        protectedPayloadPurgedAt: now,
      }) as Record<string, unknown>,
    });
    expect(transaction.scheduledReminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reminder-1',
        status: ScheduledReminderStatus.PROCESSING,
      },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  });

  it('cancels safely before first submission when PracticeLocation is no longer active', async () => {
    const { service } = createService({
      locationStatus: PracticeLocationLifecycleStatus.DISABLED,
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });
  });

  it('cancels safely before first submission when the reminder delivery window has expired', async () => {
    const { service } = createService({
      reminder: { expiresAt: now },
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({
      disposition: 'CANCELLED',
      outboxStatus: NotificationOutboxStatus.CANCELLED,
    });
  });

  it('does not reclassify an already reserved provider attempt as cancelled', async () => {
    const { service, transaction } = createService({
      attemptCount: 1,
      latestRecordedAttempt: 0,
      withdrawnAt: new Date(now.getTime() - 1_000),
      locationStatus: PracticeLocationLifecycleStatus.DISABLED,
    });

    await expect(
      service.reserveAttempt('outbox-1', 'worker-1', now),
    ).resolves.toEqual({ disposition: 'RESERVED', attemptNumber: 1 });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.update).not.toHaveBeenCalled();
    expect(transaction.scheduledReminder.updateMany).not.toHaveBeenCalled();
  });
});
