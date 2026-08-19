import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  NotificationChannel,
  NotificationType,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { PasswordResetService } from './password-reset.service';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

describe('PasswordReset notification source identity', () => {
  it('derives one logical outbox identity from the authoritative PasswordReset source', async () => {
    const transaction = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'user-1',
            email: 'doctor@example.com',
            accountStatus: UserAccountStatus.ACTIVE,
          }),
        ),
      },
      passwordReset: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'reset-source-1' })),
      },
      notificationOutbox: {
        create: jest.fn(() => Promise.resolve({ id: 'outbox-1' })),
      },
    };
    const prisma = {
      user: {
        findFirst: jest.fn(() => Promise.resolve({ id: 'user-1' })),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const config = {
      get: jest.fn(() => 'https://app.example.test'),
    };
    const payload = {
      encrypt: jest.fn((value: string, purpose: string) =>
        `enc:${purpose}:${value}`,
      ),
    };
    const passwordSecurity = {
      assertValid: jest.fn(),
      hash: jest.fn(),
    };
    const service = new PasswordResetService(
      prisma as never,
      config as unknown as ConfigService,
      payload as unknown as ProtectedAccountPayloadService,
      passwordSecurity as unknown as PasswordSecurityService,
    );

    await expect(service.request(' Doctor@Example.com ')).resolves.toEqual({
      accepted: true,
    });

    const expectedIdentity = createHash('sha256')
      .update(`${NotificationType.PASSWORD_RESET}:reset-source-1`, 'utf8')
      .digest('hex');

    expect(transaction.notificationOutbox.create).toHaveBeenCalledTimes(1);
    expect(transaction.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveryIdentityKey: expectedIdentity,
        notificationType: NotificationType.PASSWORD_RESET,
        channel: NotificationChannel.EMAIL,
        practiceLocationId: null,
        passwordResetId: 'reset-source-1',
        recipientMobileEncrypted: null,
        providerIdempotencyKey: 'password-reset:reset-source-1',
      }) as unknown,
    });
    expect(expectedIdentity).toMatch(/^[0-9a-f]{64}$/);
  });
});
