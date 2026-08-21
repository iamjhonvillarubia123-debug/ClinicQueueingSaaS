import { BadRequestException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/client';
import { NotificationDeliveryPayloadResolverService } from './notification-delivery-payload-resolver.service';
import { ClaimedOutboxRow } from './notification-outbox-claim.service';

describe('NotificationDeliveryPayloadResolverService', () => {
  const baseClaimed: ClaimedOutboxRow = {
    id: 'outbox-1',
    notificationType: NotificationType.OTP_VERIFICATION,
    channel: NotificationChannel.SMS,
    recipientMobileEncrypted: 'enc-mobile',
    recipientEmailEncrypted: null,
    messageBodyEncrypted: 'enc-message',
    providerIdempotencyKey: 'provider-key-1',
    attemptCount: 0,
    processingStartedAt: new Date('2026-08-22T00:00:00.000Z'),
    leaseExpiresAt: new Date('2026-08-22T00:05:00.000Z'),
    processingWorkerId: 'worker-1',
  };

  function createService() {
    const mobileNumberService = {
      decrypt: jest.fn(() => '+639171234567'),
    };
    const notificationPayload = {
      decryptMessage: jest.fn(() => 'notification message'),
    };
    const protectedAccountPayload = {
      decrypt: jest.fn((_: string, purpose: string) =>
        purpose.endsWith('recipient') || purpose.endsWith('recipient-email')
          ? 'doctor@example.com'
          : 'protected account message',
      ),
    };

    return {
      service: new NotificationDeliveryPayloadResolverService(
        mobileNumberService as never,
        notificationPayload as never,
        protectedAccountPayload as never,
      ),
      mobileNumberService,
      notificationPayload,
      protectedAccountPayload,
    };
  }

  it('resolves SMS using mobile and notification-message protection', () => {
    const fixture = createService();

    expect(fixture.service.resolve(baseClaimed)).toEqual({
      recipient: '+639171234567',
      messageBody: 'notification message',
    });
    expect(fixture.mobileNumberService.decrypt).toHaveBeenCalledWith(
      'enc-mobile',
    );
    expect(fixture.notificationPayload.decryptMessage).toHaveBeenCalledWith(
      'enc-message',
    );
  });

  it('resolves EMAIL whose message uses the notification-message envelope', () => {
    const fixture = createService();
    const claimed: ClaimedOutboxRow = {
      ...baseClaimed,
      notificationType: NotificationType.REFUND_COMPLETED,
      channel: NotificationChannel.EMAIL,
      recipientMobileEncrypted: null,
      recipientEmailEncrypted:
        'v1.key.notification-outbox:recipient-email.iv.tag.ciphertext',
      messageBodyEncrypted: 'notification-message-envelope',
    };

    expect(fixture.service.resolve(claimed)).toEqual({
      recipient: 'doctor@example.com',
      messageBody: 'notification message',
    });
    expect(fixture.protectedAccountPayload.decrypt).toHaveBeenCalledWith(
      claimed.recipientEmailEncrypted,
      'notification-outbox:recipient-email',
    );
  });

  it('resolves EMAIL whose secure account message uses protected-account payload', () => {
    const fixture = createService();
    fixture.notificationPayload.decryptMessage.mockImplementation(() => {
      throw new Error('not a notification message envelope');
    });
    const claimed: ClaimedOutboxRow = {
      ...baseClaimed,
      notificationType: NotificationType.PASSWORD_RESET,
      channel: NotificationChannel.EMAIL,
      recipientMobileEncrypted: null,
      recipientEmailEncrypted:
        'v1.key.password-reset:recipient.iv.tag.ciphertext',
      messageBodyEncrypted: 'v1.key.password-reset:message.iv.tag.ciphertext',
    };

    expect(fixture.service.resolve(claimed)).toEqual({
      recipient: 'doctor@example.com',
      messageBody: 'protected account message',
    });
    expect(fixture.protectedAccountPayload.decrypt).toHaveBeenCalledWith(
      claimed.messageBodyEncrypted,
      'password-reset:message',
    );
  });

  it('rejects an EMAIL recipient envelope whose purpose is not a recipient purpose', () => {
    const fixture = createService();
    const claimed: ClaimedOutboxRow = {
      ...baseClaimed,
      notificationType: NotificationType.PASSWORD_RESET,
      channel: NotificationChannel.EMAIL,
      recipientMobileEncrypted: null,
      recipientEmailEncrypted:
        'v1.key.password-reset:message.iv.tag.ciphertext',
      messageBodyEncrypted: 'v1.key.password-reset:message.iv.tag.ciphertext',
    };

    expect(() => fixture.service.resolve(claimed)).toThrow(BadRequestException);
    expect(fixture.protectedAccountPayload.decrypt).not.toHaveBeenCalled();
  });
});
