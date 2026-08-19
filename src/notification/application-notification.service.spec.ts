import { NotFoundException } from '@nestjs/common';
import { ApplicationNotificationType } from '../../generated/prisma/client';
import { ApplicationNotificationService } from './application-notification.service';

describe('ApplicationNotificationService', () => {
  const createdAt = new Date('2026-08-19T10:00:00.000Z');
  const notification = {
    id: 'notification-1',
    notificationType: ApplicationNotificationType.SECRETARY_ACCOUNT_DISABLED,
    affectedSecretaryUserId: 'secretary-1',
    practiceLocationId: 'location-1',
    createdAt,
    readAt: null as Date | null,
  };

  function createFixture() {
    const transaction = {
      applicationNotification: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    };
    const prisma = {
      applicationNotification: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const service = new ApplicationNotificationService(prisma as never);
    return { service, prisma, transaction };
  }

  it('lists only notifications scoped to the authenticated recipient', async () => {
    const fixture = createFixture();
    fixture.prisma.applicationNotification.findMany.mockResolvedValue([
      notification,
    ]);

    await expect(fixture.service.listForRecipient('doctor-1')).resolves.toEqual(
      [notification],
    );
    expect(
      fixture.prisma.applicationNotification.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: 'doctor-1' } }),
    );
  });

  it('counts only unread notifications owned by the authenticated recipient', async () => {
    const fixture = createFixture();
    fixture.prisma.applicationNotification.count.mockResolvedValue(3);

    await expect(fixture.service.unreadCount('doctor-1')).resolves.toEqual({
      unreadCount: 3,
    });
    expect(fixture.prisma.applicationNotification.count).toHaveBeenCalledWith({
      where: { recipientUserId: 'doctor-1', readAt: null },
    });
  });

  it('marks an owned unread notification read and keeps recipient scope on the update', async () => {
    const fixture = createFixture();
    const readNotification = { ...notification, readAt: createdAt };
    fixture.transaction.applicationNotification.findFirst.mockResolvedValue(
      notification,
    );
    fixture.transaction.applicationNotification.updateMany.mockResolvedValue({
      count: 1,
    });
    fixture.transaction.applicationNotification.findFirstOrThrow.mockResolvedValue(
      readNotification,
    );

    await expect(
      fixture.service.markRead('doctor-1', notification.id),
    ).resolves.toEqual(readNotification);
    expect(
      fixture.transaction.applicationNotification.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: notification.id,
          recipientUserId: 'doctor-1',
          readAt: null,
        },
      }),
    );
  });

  it('returns an already-read owned notification without another transition', async () => {
    const fixture = createFixture();
    const alreadyRead = { ...notification, readAt: createdAt };
    fixture.transaction.applicationNotification.findFirst.mockResolvedValue(
      alreadyRead,
    );

    await expect(
      fixture.service.markRead('doctor-1', notification.id),
    ).resolves.toEqual(alreadyRead);
    expect(
      fixture.transaction.applicationNotification.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('does not allow the affected secretary or any non-recipient to mark the notification read', async () => {
    const fixture = createFixture();
    fixture.transaction.applicationNotification.findFirst.mockResolvedValue(
      null,
    );

    await expect(
      fixture.service.markRead('secretary-1', notification.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      fixture.transaction.applicationNotification.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: notification.id, recipientUserId: 'secretary-1' },
      }),
    );
    expect(
      fixture.transaction.applicationNotification.updateMany,
    ).not.toHaveBeenCalled();
  });
});
