import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  AccountLoginIdentifierType,
  AdministrativeRestrictionStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  OtpPurpose,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { OtpGenerator } from '../otp/otp.generator';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_IDLE_LIFETIME_MS,
} from './security/session-security';

const OTP_LIFETIME_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const PURPOSE = OtpPurpose.ACCOUNT_MOBILE_VERIFICATION;

type Tx = Prisma.TransactionClient;

type VerifiableRole = typeof UserRole.DOCTOR | typeof UserRole.SECRETARY;

@Injectable()
export class AccountMobileVerificationService {
  private readonly otpHmacKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mobileNumbers: MobileNumberService,
    private readonly otpGenerator: OtpGenerator,
    private readonly notificationPayload: NotificationPayloadService,
  ) {
    const key = Buffer.from(
      this.config.getOrThrow<string>('OTP_HMAC_KEY_V1'),
      'base64',
    );
    if (key.length !== 32) {
      throw new Error('OTP_HMAC_KEY_V1 must decode to exactly 32 bytes.');
    }
    this.otpHmacKey = key;
  }

  async createInitialVerification(
    tx: Tx,
    userId: string,
    canonicalMobile: string,
    mobileHash: string,
  ): Promise<{ expiresAt: Date }> {
    return this.issue(tx, userId, canonicalMobile, mobileHash, new Date());
  }

  async resend(userId: string): Promise<{ accepted: true }> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!current) return { accepted: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
      `;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          loginIdentifierType: true,
          mobileNumber: true,
          mobileNumberHash: true,
          mobileVerifiedAt: true,
        },
      });
      if (!user || !this.isEligible(user)) return;
      if (!user.mobileNumber || !user.mobileNumberHash) return;

      const latest = await tx.otpVerification.findFirst({
        where: { userId, purpose: PURPOSE },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const now = new Date();
      if (
        latest &&
        now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS
      ) {
        return;
      }

      await this.issue(
        tx,
        user.id,
        user.mobileNumber,
        user.mobileNumberHash,
        now,
      );
    });

    return { accepted: true };
  }

  async verify(
    userId: string,
    submittedOtp: string,
  ): Promise<{
    verified: true;
    role: VerifiableRole;
    sessionToken: string;
  }> {
    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const activeContextKey = this.activeContextKey(userId);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "OtpVerification"
        WHERE "activeContextKey" = ${activeContextKey}
        LIMIT 1
        FOR UPDATE
      `);
      if (!locked[0]) return { kind: 'invalid' as const };

      const challenge = await tx.otpVerification.findUnique({
        where: { id: locked[0].id },
        select: {
          id: true,
          userId: true,
          purpose: true,
          otpHash: true,
          attemptCount: true,
          expiresAt: true,
          verifiedAt: true,
          consumedAt: true,
          invalidatedAt: true,
          notificationOutbox: { select: { id: true, status: true } },
        },
      });
      if (
        !challenge ||
        challenge.userId !== userId ||
        challenge.purpose !== PURPOSE ||
        !challenge.otpHash ||
        challenge.verifiedAt ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        challenge.attemptCount >= MAX_ATTEMPTS
      ) {
        return { kind: 'invalid' as const };
      }

      const now = new Date();
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        await this.invalidate(tx, challenge.id, now);
        return { kind: 'invalid' as const };
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          loginIdentifierType: true,
          mobileVerifiedAt: true,
        },
      });
      if (!user || !this.isEligible(user)) {
        await this.invalidate(tx, challenge.id, now);
        return { kind: 'invalid' as const };
      }

      if (!this.matches(userId, submittedOtp, challenge.otpHash)) {
        const attemptCount = challenge.attemptCount + 1;
        await tx.otpVerification.update({
          where: { id: challenge.id },
          data:
            attemptCount >= MAX_ATTEMPTS
              ? {
                  attemptCount: { increment: 1 },
                  invalidatedAt: now,
                  activeContextKey: null,
                  otpHash: null,
                }
              : { attemptCount: { increment: 1 } },
        });
        return { kind: 'invalid' as const };
      }

      await tx.user.update({
        where: { id: userId },
        data: { mobileVerifiedAt: now },
      });
      await tx.otpVerification.update({
        where: { id: challenge.id },
        data: {
          verifiedAt: now,
          consumedAt: now,
          activeContextKey: null,
          otpHash: null,
        },
      });
      if (
        challenge.notificationOutbox?.status ===
        NotificationOutboxStatus.PENDING
      ) {
        await tx.notificationOutbox.update({
          where: { id: challenge.notificationOutbox.id },
          data: { status: NotificationOutboxStatus.CANCELLED, cancelledAt: now },
        });
      }
      await tx.userSession.create({
        data: {
          userId,
          tokenHash: sessionTokenHash,
          lastSeenAt: now,
          idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_LIFETIME_MS),
          expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS),
          revokedAt: null,
        },
      });

      return { kind: 'verified' as const, role: user.role };
    });

    if (outcome.kind !== 'verified') {
      throw new BadRequestException('Invalid or expired verification code.');
    }
    return { verified: true, role: outcome.role, sessionToken };
  }

  private async issue(
    tx: Tx,
    userId: string,
    canonicalMobile: string,
    mobileHash: string,
    now: Date,
  ): Promise<{ expiresAt: Date }> {
    const activeContextKey = this.activeContextKey(userId);
    const existing = await tx.otpVerification.findUnique({
      where: { activeContextKey },
      include: { notificationOutbox: true },
    });
    if (existing) {
      await tx.otpVerification.update({
        where: { id: existing.id },
        data: {
          invalidatedAt: now,
          activeContextKey: null,
          otpHash: null,
        },
      });
      if (existing.notificationOutbox?.status === NotificationOutboxStatus.PENDING) {
        await tx.notificationOutbox.update({
          where: { id: existing.notificationOutbox.id },
          data: { status: NotificationOutboxStatus.CANCELLED, cancelledAt: now },
        });
      }
    }

    const otp = this.otpGenerator.generate();
    const expiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);
    const challenge = await tx.otpVerification.create({
      data: {
        userId,
        purpose: PURPOSE,
        mobileNumberHash: mobileHash,
        mobileHashKeyVersion: 1,
        otpHash: this.hashOtp(userId, otp),
        otpHashKeyVersion: 1,
        activeContextKey,
        expiresAt,
      },
    });
    const recipientMobileEncrypted =
      this.mobileNumbers.encryptCanonical(canonicalMobile);
    const message = `Your Clinic Queueing verification code is ${otp}. It expires in 5 minutes.`;
    await tx.notificationOutbox.create({
      data: {
        deliveryIdentityKey: this.sha256(
          `${NotificationType.OTP_VERIFICATION}|${challenge.id}`,
        ),
        notificationType: NotificationType.OTP_VERIFICATION,
        channel: NotificationChannel.SMS,
        status: NotificationOutboxStatus.PENDING,
        practiceLocationId: null,
        otpVerificationId: challenge.id,
        recipientMobileEncrypted,
        recipientEmailEncrypted: null,
        messageBodyEncrypted: this.notificationPayload.encryptMessage(message),
        providerIdempotencyKey: `account-mobile-verification:${challenge.id}`,
        nextAttemptAt: now,
        expiresAt,
      },
    });
    return { expiresAt };
  }

  private isEligible(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    loginIdentifierType: AccountLoginIdentifierType;
    mobileVerifiedAt: Date | null;
  }): user is typeof user & { role: VerifiableRole } {
    if (user.role !== UserRole.DOCTOR && user.role !== UserRole.SECRETARY) return false;
    if (user.accountStatus !== UserAccountStatus.ACTIVE) return false;
    if (user.loginIdentifierType !== AccountLoginIdentifierType.MOBILE) return false;
    if (user.mobileVerifiedAt !== null) return false;
    if (
      user.role === UserRole.DOCTOR &&
      user.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) return false;
    return true;
  }

  private async invalidate(tx: Tx, id: string, now: Date): Promise<void> {
    await tx.otpVerification.update({
      where: { id },
      data: { invalidatedAt: now, activeContextKey: null, otpHash: null },
    });
  }

  private activeContextKey(userId: string): string {
    return `ACCOUNT_MOBILE_VERIFICATION:${userId}`;
  }

  private hashOtp(userId: string, otp: string): string {
    return createHmac('sha256', this.otpHmacKey)
      .update(`${userId}:${PURPOSE}:${otp}`, 'utf8')
      .digest('hex');
  }

  private matches(userId: string, otp: string, storedHash: string): boolean {
    const calculated = Buffer.from(this.hashOtp(userId, otp), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return calculated.length === stored.length && timingSafeEqual(calculated, stored);
  }

  private sha256(value: string): string {
    return createHmac('sha256', this.otpHmacKey).update(value, 'utf8').digest('hex');
  }
}
