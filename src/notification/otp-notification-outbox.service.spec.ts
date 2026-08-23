import { NotificationPayloadService } from './notification-payload.service';
import { OtpNotificationOutboxService } from './otp-notification-outbox.service';

describe('OtpNotificationOutboxService', () => {
  const notificationPayload = {
    encryptMessage: jest.fn(),
  };
  const notificationOutbox = {
    create: jest.fn(),
  };
  const transaction = {
    notificationOutbox,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    notificationPayload.encryptMessage.mockReturnValue('encrypted-message');
    notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
  });

  it('persists one encrypted OTP delivery intent without plaintext recipient data', async () => {
    const service = new OtpNotificationOutboxService(
      notificationPayload as unknown as NotificationPayloadService,
    );
    const createdAt = new Date('2026-08-22T06:00:00.000Z');

    await service.createBookingOtpOutbox(transaction as never, {
      otpVerificationId: 'otp-1',
      practiceLocationId: 'location-1',
      recipientMobileEncrypted: 'encrypted-mobile',
      otp: '123456',
      createdAt,
    });

    expect(notificationPayload.encryptMessage).toHaveBeenCalledWith(
      'Your Clinic Queueing verification code is 123456. It expires in 5 minutes.',
    );
    expect(notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: 'OTP_VERIFICATION',
        channel: 'SMS',
        status: 'PENDING',
        practiceLocationId: 'location-1',
        otpVerificationId: 'otp-1',
        recipientMobileEncrypted: 'encrypted-mobile',
        recipientEmailEncrypted: null,
        messageBodyEncrypted: 'encrypted-message',
        providerIdempotencyKey: 'otp-verification:otp-1',
        attemptCount: 0,
        nextAttemptAt: createdAt,
        createdAt,
      }) as unknown,
    });

    const persisted = JSON.stringify(notificationOutbox.create.mock.calls[0]);
    expect(persisted).not.toContain('123456');
  });
});
