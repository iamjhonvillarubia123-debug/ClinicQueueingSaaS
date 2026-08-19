import {
  NotificationOutboxStatus,
  ScheduledReminderStatus,
} from '../../generated/prisma/client';
import { ScheduledReminderHandoffService } from './scheduled-reminder-handoff.service';

describe('ScheduledReminderHandoffService', () => {
  function createFixture() {
    const transaction = {
      $queryRaw: jest.fn(),
      notificationOutbox: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      contactPreference: { findUnique: jest.fn() },
      scheduledReminder: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('https://app.example.test/'),
    };
    const notificationPayload = {
      encryptMessage: jest
        .fn<string, [string]>()
        .mockReturnValue('encrypted-final-message'),
    };
    const service = new ScheduledReminderHandoffService(
      prisma as never,
      configService as never,
      notificationPayload as never,
    );
    return { service, transaction, notificationPayload };
  }

  function dueReminder() {
    return {
      id: 'reminder-1',
      practiceLocationId: 'location-1',
      contactPreferenceId: 'preference-1',
      recipientMobileEncrypted: 'encrypted-mobile',
      status: ScheduledReminderStatus.SCHEDULED,
      scheduledFor: new Date('2026-08-19T10:00:00.000Z'),
      expiresAt: new Date('2026-08-20T10:00:00.000Z'),
      messageBody: 'Please schedule your follow-up.',
    };
  }

  it('atomically creates one outbox and moves a due eligible reminder to PROCESSING', async () => {
    const fixture = createFixture();
    const now = new Date('2026-08-19T12:00:00.000Z');
    fixture.transaction.$queryRaw.mockResolvedValue([dueReminder()]);
    fixture.transaction.notificationOutbox.findUnique.mockResolvedValue(null);
    fixture.transaction.contactPreference.findUnique.mockResolvedValue({
      allowFollowUpReminder: true,
      withdrawnAt: null,
    });
    fixture.transaction.notificationOutbox.create.mockResolvedValue({
      id: 'outbox-1',
    });

    await expect(
      fixture.service.handoffOne('reminder-1', now),
    ).resolves.toEqual({
      scheduledReminderId: 'reminder-1',
      status: ScheduledReminderStatus.PROCESSING,
      notificationOutboxId: 'outbox-1',
      disposition: 'HANDED_OFF',
    });
    expect(fixture.notificationPayload.encryptMessage).toHaveBeenCalledWith(
      'Please schedule your follow-up.\n\nBook again: https://app.example.test/book/location-1',
    );
    expect(
      fixture.transaction.notificationOutbox.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationOutboxStatus.PENDING,
          scheduledReminderId: 'reminder-1',
          recipientMobileEncrypted: 'encrypted-mobile',
          providerIdempotencyKey: 'scheduled-reminder:reminder-1',
        }),
      }),
    );
    expect(fixture.transaction.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: 'reminder-1' },
      data: { status: ScheduledReminderStatus.PROCESSING },
    });
  });

  it('cancels before handoff when optional reminder permission was withdrawn', async () => {
    const fixture = createFixture();
    const now = new Date('2026-08-19T12:00:00.000Z');
    fixture.transaction.$queryRaw.mockResolvedValue([dueReminder()]);
    fixture.transaction.notificationOutbox.findUnique.mockResolvedValue(null);
    fixture.transaction.contactPreference.findUnique.mockResolvedValue({
      allowFollowUpReminder: true,
      withdrawnAt: new Date('2026-08-19T11:00:00.000Z'),
    });

    await expect(
      fixture.service.handoffOne('reminder-1', now),
    ).resolves.toEqual({
      scheduledReminderId: 'reminder-1',
      status: ScheduledReminderStatus.CANCELLED,
      notificationOutboxId: null,
      disposition: 'CANCELLED',
    });
    expect(
      fixture.transaction.notificationOutbox.create,
    ).not.toHaveBeenCalled();
    expect(fixture.transaction.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: 'reminder-1' },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  });

  it('expires a due reminder without creating an outbox after its expiry', async () => {
    const fixture = createFixture();
    const now = new Date('2026-08-21T12:00:00.000Z');
    fixture.transaction.$queryRaw.mockResolvedValue([dueReminder()]);
    fixture.transaction.notificationOutbox.findUnique.mockResolvedValue(null);

    await expect(
      fixture.service.handoffOne('reminder-1', now),
    ).resolves.toEqual({
      scheduledReminderId: 'reminder-1',
      status: ScheduledReminderStatus.EXPIRED,
      notificationOutboxId: null,
      disposition: 'EXPIRED',
    });
    expect(
      fixture.transaction.notificationOutbox.create,
    ).not.toHaveBeenCalled();
    expect(fixture.transaction.scheduledReminder.update).toHaveBeenCalledWith({
      where: { id: 'reminder-1' },
      data: {
        status: ScheduledReminderStatus.EXPIRED,
        expiredAt: now,
      },
    });
  });

  it('does not create a second logical outbox when one already exists', async () => {
    const fixture = createFixture();
    fixture.transaction.$queryRaw.mockResolvedValue([
      { ...dueReminder(), status: ScheduledReminderStatus.PROCESSING },
    ]);
    fixture.transaction.notificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-1',
    });

    await expect(fixture.service.handoffOne('reminder-1')).resolves.toEqual({
      scheduledReminderId: 'reminder-1',
      status: ScheduledReminderStatus.PROCESSING,
      notificationOutboxId: 'outbox-1',
      disposition: 'ALREADY_HANDED_OFF',
    });
    expect(
      fixture.transaction.notificationOutbox.create,
    ).not.toHaveBeenCalled();
  });
});
