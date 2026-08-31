import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  EmailVerificationStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailVerificationService } from './email-verification.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

type VerificationCreateArgs = {
  data: {
    userId: string;
    tokenHash: string;
    activeVerificationKey: string;
    status: EmailVerificationStatus;
    createdAt: Date;
    expiresAt: Date;
  };
};

type OutboxCreateArgs = {
  data: {
    deliveryIdentityKey: string;
    notificationType: NotificationType;
    channel: NotificationChannel;
    status: NotificationOutboxStatus;
    practiceLocationId: null;
    emailVerificationId: string;
    recipientMobileEncrypted: null;
    recipientEmailEncrypted: string;
    messageBodyEncrypted: string;
    providerIdempotencyKey: string;
    nextAttemptAt: Date;
    expiresAt: Date;
  };
};

describe('EmailVerificationService', () => {
  const key = Buffer.alloc(32, 9).toString('base64');
  const configService = {
    get: jest.fn((name: string): string | undefined =>
      name === 'PUBLIC_APP_BASE_URL' ? 'https://app.example.test' : undefined,
    ),
    getOrThrow: jest.fn((name: string): string => {
      if (name === 'MOBILE_ENCRYPTION_KEY_V1') return key;
      if (name === 'MOBILE_ENCRYPTION_ACTIVE_KEY_ID') return 'v1';
      throw new Error(`Unexpected config key: ${name}`);
    }),
  } as unknown as ConfigService;

  const protectedPayloadService = new ProtectedAccountPayloadService(
    configService,
  );

  it('creates a 24-hour pending verification and EMAIL outbox without standalone raw-token storage', async () => {
    const verificationCreate = jest.fn(
      (args: VerificationCreateArgs): Promise<{ id: string }> => {
        void args;
        return Promise.resolve({ id: 'verification-1' });
      },
    );
    const outboxCreate = jest.fn(
      (args: OutboxCreateArgs): Promise<{ id: string }> => {
        void args;
        return Promise.resolve({ id: 'outbox-1' });
      },
    );
    const transaction = {
      emailVerification: { create: verificationCreate },
      notificationOutbox: { create: outboxCreate },
    } as unknown as Prisma.TransactionClient;

    const service = new EmailVerificationService(
      {} as PrismaService,
      configService,
      protectedPayloadService,
    );

    const result = await service.createInitialVerification(
      transaction,
      'user-1',
      'doctor@example.com',
    );

    const verificationData = verificationCreate.mock.calls[0][0].data;
    const outboxData = outboxCreate.mock.calls[0][0].data;

    expect(verificationData.status).toBe(EmailVerificationStatus.PENDING);
    expect(verificationData.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verificationData.activeVerificationKey).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verificationData.expiresAt.getTime() -
        verificationData.createdAt.getTime(),
    ).toBe(24 * 60 * 60 * 1000);

    expect(outboxData.notificationType).toBe(
      NotificationType.DOCTOR_EMAIL_VERIFICATION,
    );
    expect(outboxData.channel).toBe(NotificationChannel.EMAIL);
    expect(outboxData.practiceLocationId).toBeNull();
    expect(outboxData.emailVerificationId).toBe('verification-1');
    expect(outboxData.recipientMobileEncrypted).toBeNull();
    expect(outboxData.status).toBe(NotificationOutboxStatus.PENDING);

    expect(
      protectedPayloadService.decrypt(
        outboxData.recipientEmailEncrypted,
        'doctor-email-verification:recipient',
      ),
    ).toBe('doctor@example.com');

    const message = protectedPayloadService.decrypt(
      outboxData.messageBodyEncrypted,
      'doctor-email-verification:message',
    );
    const matchedUrl = message.match(/https:\/\/\S+/)?.[0];
    expect(matchedUrl).toBeDefined();
    const token = new URL(
      matchedUrl ?? 'https://invalid.test',
    ).searchParams.get('token');

    expect(token).toBeTruthy();
    expect(
      createHash('sha256')
        .update(token ?? '')
        .digest('hex'),
    ).toBe(verificationData.tokenHash);
    expect(JSON.stringify(verificationData)).not.toContain(token ?? 'never');
    expect(result.expiresAt).toEqual(verificationData.expiresAt);
  });

  it.each([UserRole.DOCTOR, UserRole.SECRETARY])(
    'verifies one eligible %s account without creating a session',
    async (role) => {
      const userUpdate = jest.fn();
      const verificationUpdate = jest.fn();
      const outboxUpdate = jest.fn();
      const userSessionCreate = jest.fn();
      const token = `single-use-token-${role}`;
      const tokenHash = createHash('sha256').update(token).digest('hex');

      const transaction = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'verification-1' }]),
        emailVerification: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'verification-1',
            userId: 'user-1',
            tokenHash,
            activeVerificationKey: 'a'.repeat(64),
            status: EmailVerificationStatus.PENDING,
            expiresAt: new Date(Date.now() + 60_000),
            user: {
              id: 'user-1',
              role,
              accountStatus: UserAccountStatus.ACTIVE,
              administrativeRestrictionStatus:
                AdministrativeRestrictionStatus.NONE,
              emailVerifiedAt: null,
            },
            notificationOutbox: {
              id: 'outbox-1',
              status: NotificationOutboxStatus.PENDING,
            },
          }),
          update: verificationUpdate,
        },
        user: { update: userUpdate },
        notificationOutbox: { update: outboxUpdate },
        userSession: { create: userSessionCreate },
      };
      const prisma = {
        $transaction: jest.fn(
          (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      } as unknown as PrismaService;

      const service = new EmailVerificationService(
        prisma,
        configService,
        protectedPayloadService,
      );

      const result = await service.verify(token);
      expect(result).toMatchObject({ verified: true, role });
      expect(result.sessionToken).toBeTruthy();

      const userUpdateCalls = userUpdate.mock.calls as unknown as Array<
        [{ data: { emailVerifiedAt: Date } }]
      >;
      const verificationUpdateCalls = verificationUpdate.mock
        .calls as unknown as Array<
        [
          {
            data: {
              status: EmailVerificationStatus;
              verifiedAt: Date;
              tokenHash: null;
              activeVerificationKey: null;
            };
          },
        ]
      >;
      const outboxUpdateCalls = outboxUpdate.mock.calls as unknown as Array<
        [{ data: { status: NotificationOutboxStatus } }]
      >;

      const emailVerifiedAt = userUpdateCalls[0][0].data.emailVerifiedAt;
      const verificationData = verificationUpdateCalls[0][0].data;

      expect(verificationData.status).toBe(EmailVerificationStatus.VERIFIED);
      expect(verificationData.verifiedAt).toBe(emailVerifiedAt);
      expect(verificationData.tokenHash).toBeNull();
      expect(verificationData.activeVerificationKey).toBeNull();
      expect(outboxUpdateCalls[0][0].data.status).toBe(
        NotificationOutboxStatus.CANCELLED,
      );
      expect(userSessionCreate).toHaveBeenCalledTimes(1);
      expect(userSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
          revokedAt: null,
        }) as unknown,
      });
      expect(JSON.stringify(userSessionCreate.mock.calls)).not.toContain(
        result.sessionToken,
      );
    },
  );

  it('expires an elapsed verification and rejects the link without verifying the user', async () => {
    const userUpdate = jest.fn();
    const verificationUpdate = jest.fn();
    const token = 'expired-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'verification-1' }]),
      emailVerification: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'verification-1',
          userId: 'user-1',
          tokenHash,
          activeVerificationKey: 'b'.repeat(64),
          status: EmailVerificationStatus.PENDING,
          expiresAt: new Date(Date.now() - 1_000),
          user: {
            id: 'user-1',
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: null,
          },
          notificationOutbox: null,
        }),
        update: verificationUpdate,
      },
      user: { update: userUpdate },
      notificationOutbox: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;

    const service = new EmailVerificationService(
      prisma,
      configService,
      protectedPayloadService,
    );

    await expect(service.verify(token)).rejects.toThrow(
      'Invalid or expired verification link.',
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(verificationUpdate).toHaveBeenCalledWith({
      where: { id: 'verification-1' },
      data: {
        status: EmailVerificationStatus.EXPIRED,
        tokenHash: null,
        activeVerificationKey: null,
      },
    });
  });

  it('returns the same generic resend response when no current account exists', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const service = new EmailVerificationService(
      prisma,
      configService,
      protectedPayloadService,
    );

    await expect(service.resend('missing@example.com')).resolves.toEqual({
      accepted: true,
    });
    expect(
      (prisma as unknown as { $transaction: jest.Mock }).$transaction,
    ).not.toHaveBeenCalled();
  });

  it('revokes the current pending verification and creates one replacement after the User-scoped lock', async () => {
    const verificationUpdate = jest.fn().mockResolvedValue({});
    const outboxUpdate = jest.fn().mockResolvedValue({});
    const verificationCreate = jest
      .fn()
      .mockResolvedValue({ id: 'verification-2' });
    const outboxCreate = jest.fn().mockResolvedValue({ id: 'outbox-2' });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'secretary@example.com',
          role: UserRole.SECRETARY,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
          emailVerifiedAt: null,
        }),
      },
      emailVerification: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        findFirst: jest.fn().mockResolvedValue({
          id: 'verification-1',
          notificationOutbox: {
            id: 'outbox-1',
            status: NotificationOutboxStatus.PENDING,
          },
        }),
        update: verificationUpdate,
        create: verificationCreate,
      },
      notificationOutbox: {
        update: outboxUpdate,
        create: outboxCreate,
      },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new EmailVerificationService(
      prisma,
      configService,
      protectedPayloadService,
    );

    await expect(service.resend(' Secretary@Example.com ')).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(verificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'verification-1' },
        data: expect.objectContaining({
          status: EmailVerificationStatus.REVOKED,
          tokenHash: null,
          activeVerificationKey: null,
        }) as unknown,
      }),
    );
    expect(outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          status: NotificationOutboxStatus.CANCELLED,
        }) as unknown,
      }),
    );
    expect(verificationCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });
});
