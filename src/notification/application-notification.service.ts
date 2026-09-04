import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const applicationNotificationSelect = {
  id: true,
  notificationType: true,
  affectedSecretaryUserId: true,
  practiceLocationId: true,
  createdAt: true,
  readAt: true,
  title: true,
  message: true,
} as const;

@Injectable()
export class ApplicationNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listForRecipient(recipientUserId: string) {
    const rows = await this.prisma.applicationNotification.findMany({
      where: { recipientUserId },
      select: {
        ...applicationNotificationSelect,
        affectedSecretaryUser: {
          select: { firstName: true, lastName: true, accountStatus: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(({ affectedSecretaryUser, ...item }) =>
      affectedSecretaryUser
        ? {
            ...item,
            affectedSecretaryName:
              affectedSecretaryUser.accountStatus === 'PERMANENTLY_CLOSED'
                ? 'Closed secretary account'
                : `${affectedSecretaryUser.firstName} ${affectedSecretaryUser.lastName}`.trim(),
          }
        : item,
    );
  }

  async unreadCount(recipientUserId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.applicationNotification.count({
      where: { recipientUserId, readAt: null },
    });
    return { unreadCount };
  }

  async markRead(recipientUserId: string, notificationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const notification = await transaction.applicationNotification.findFirst({
        where: { id: notificationId, recipientUserId },
        select: applicationNotificationSelect,
      });

      if (!notification) {
        throw new NotFoundException('Application notification was not found.');
      }

      if (notification.readAt) {
        return notification;
      }

      const readAt = new Date();
      await transaction.applicationNotification.updateMany({
        where: { id: notificationId, recipientUserId, readAt: null },
        data: { readAt },
      });

      return transaction.applicationNotification.findFirstOrThrow({
        where: { id: notificationId, recipientUserId },
        select: applicationNotificationSelect,
      });
    });
  }
}
