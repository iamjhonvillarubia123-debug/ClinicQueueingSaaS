import { NotificationType } from '../../generated/prisma/client';
import { RefundNotificationService } from './refund-notification.service';

describe('RefundNotificationService', () => {
  const occurredAt = new Date('2026-08-20T15:00:00.000Z');

  function createFixture(existing = false) {
    const transaction = {
      notificationOutbox: {
        findUnique: jest.fn(() =>
          Promise.resolve(existing ? { id: 'outbox-existing' } : null),
        ),
        create: jest.fn(() => Promise.resolve({ id: 'outbox-1' })),
      },
    };
    const protectedPayload = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    };
    const notificationPayload = {
      encryptMessage: jest.fn((value: string) => `message:${value}`),
    };
    const service = new RefundNotificationService(
      protectedPayload as never,
      notificationPayload as never,
    );
    return { service, transaction };
  }

  it('creates one EMAIL outbox anchored to the exact RefundRequest', async () => {
    const { service, transaction } = createFixture();

    await service.create(transaction as never, {
      notificationType: NotificationType.REFUND_COMPLETED,
      refundRequestId: 'refund-1',
      recipientEmail: 'doctor@example.com',
      message: 'Refund completed.',
      occurredAt,
    });

    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: NotificationType.REFUND_COMPLETED,
        refundRequestId: 'refund-1',
        practiceLocationId: null,
      }) as object,
    });
  });

  it('does not create a duplicate logical email for the same delivery identity', async () => {
    const { service, transaction } = createFixture(true);

    await service.create(transaction as never, {
      notificationType: NotificationType.REFUND_FAILED,
      refundRequestId: 'refund-1',
      recipientEmail: 'doctor@example.com',
      message: 'Refund failed.',
      occurredAt,
    });

    expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();
  });
});
