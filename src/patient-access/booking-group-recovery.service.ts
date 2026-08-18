import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BookingGroupAccessTokenPurpose,
  BookingGroupRecoveryAttemptStatus,
  CommandType,
  OtpPurpose,
  Prisma,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { OtpGenerator } from '../otp/otp.generator';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  RequestBookingGroupRecoveryDto,
  VerifyBookingGroupRecoveryOtpDto,
} from './dto/booking-group-recovery.dto';

const GROUP_RECOVERY_PURPOSE = OtpPurpose.BOOKING_GROUP_RECOVERY;
const OTP_LIFETIME_MS = 5 * 60 * 1000;
const RECOVERY_LIFETIME_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const CONTEXT_WINDOW_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_CHALLENGE = 5;
const MAX_FAILED_SUBMISSIONS_PER_CONTEXT = 10;
const MAX_CHALLENGES_PER_CONTEXT = 5;
const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_AFTER_SERVICE_DATE_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_RECOVERY_MESSAGE =
  'If the booking group can be recovered, verification will continue.';
const GENERIC_FAILURE = 'Booking group recovery is unavailable.';

type LockedRecoveryAttempt = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberHash: string | null;
  bookingGroupId: string | null;
  status: BookingGroupRecoveryAttemptStatus;
  expiresAt: Date;
  completedAt: Date | null;
};

type LockedRecoveryOtp = {
  id: string;
  bookingGroupRecoveryAttemptId: string | null;
  otpHash: string | null;
  purpose: OtpPurpose;
  activeContextKey: string | null;
  attemptCount: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

@Injectable()
export class BookingGroupRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumber: MobileNumberService,
    private readonly otpGenerator: OtpGenerator,
    private readonly otpService: OtpService,
    private readonly idempotency: CommandIdempotencyService,
  ) {}

  async request(dto: RequestBookingGroupRecoveryDto) {
    const protectedMobile = this.mobileNumber.protect(dto.mobileNumber);
    const serviceDate = new Date(`${dto.serviceDate}T00:00:00.000Z`);
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.bookingGroup.findMany({
        where: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          controllingMobileNumberHash: protectedMobile.hash,
          appointments: { some: { anonymizedAt: null } },
        },
        select: { id: true },
        take: 2,
      });
      const resolvedBookingGroupId =
        candidates.length === 1 ? candidates[0].id : null;

      const attempt = await transaction.bookingGroupRecoveryAttempt.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          mobileNumberEncrypted: protectedMobile.encrypted,
          mobileNumberHash: protectedMobile.hash,
          mobileHashKeyVersion: 1,
          mobileNumberLastFour: protectedMobile.lastFour,
          bookingGroupId: resolvedBookingGroupId,
          status: BookingGroupRecoveryAttemptStatus.PENDING_OTP,
          expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS),
        },
        select: { id: true, expiresAt: true },
      });

      await this.issueOtp(transaction, attempt.id, protectedMobile.hash, now);

      return {
        message: GENERIC_RECOVERY_MESSAGE,
        recoveryAttemptId: attempt.id,
        expiresAt: attempt.expiresAt,
      };
    });
  }

  async resend(recoveryAttemptId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, recoveryAttemptId);
      this.assertPendingAttempt(attempt, now);
      if (!attempt.mobileNumberHash) this.fail();
      await this.issueOtp(transaction, attempt.id, attempt.mobileNumberHash, now);
      return { message: GENERIC_RECOVERY_MESSAGE, recoveryAttemptId };
    });
  }

  async verify(dto: VerifyBookingGroupRecoveryOtpDto) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, dto.recoveryAttemptId);
      this.assertPendingAttempt(attempt, now);
      const activeContextKey = this.activeContextKey(attempt.id);
      const rows = await transaction.$queryRaw<LockedRecoveryOtp[]>(Prisma.sql`
        SELECT
          "id",
          "bookingGroupRecoveryAttemptId",
          "otpHash",
          "purpose",
          "activeContextKey",
          "attemptCount",
          "expiresAt",
          "verifiedAt",
          "consumedAt",
          "invalidatedAt"
        FROM "OtpVerification"
        WHERE "activeContextKey" = ${activeContextKey}
        FOR UPDATE
      `);
      const otp = rows[0];
      if (
        !otp ||
        otp.bookingGroupRecoveryAttemptId !== attempt.id ||
        otp.purpose !== GROUP_RECOVERY_PURPOSE ||
        otp.verifiedAt ||
        otp.consumedAt ||
        otp.invalidatedAt ||
        !otp.otpHash ||
        otp.attemptCount >= MAX_ATTEMPTS_PER_CHALLENGE ||
        otp.expiresAt.getTime() <= now.getTime()
      ) {
        this.fail();
      }

      const failures = await this.contextFailureCount(transaction, attempt.id, now);
      if (failures >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT) this.fail();

      const matches = this.otpService.verifyOtpHash(
        attempt.id,
        GROUP_RECOVERY_PURPOSE,
        dto.otp,
        otp.otpHash,
      );
      if (!matches) {
        const invalidate =
          otp.attemptCount + 1 >= MAX_ATTEMPTS_PER_CHALLENGE ||
          failures + 1 >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT;
        await transaction.otpVerification.update({
          where: { id: otp.id },
          data: {
            attemptCount: { increment: 1 },
            ...(invalidate
              ? { invalidatedAt: now, activeContextKey: null, otpHash: null }
              : {}),
          },
        });
        this.fail();
      }

      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: { verifiedAt: now },
      });
      await transaction.bookingGroupRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingGroupRecoveryAttemptStatus.VERIFIED,
          verifiedAt: now,
        },
      });
      return { verified: true, recoveryAttemptId: attempt.id };
    });
  }

  async complete(recoveryAttemptId: string, idempotencyKey: string | undefined) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
      scope: { bookingGroupRecoveryAttemptId: recoveryAttemptId },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      recoveryCompletion: true,
    });

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(transaction, commandIdentityKey);
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        return {
          replayed: true,
          bookingGroupId: replay.resultBookingGroupId,
          replacementTokenRecordId: replay.resultBookingGroupAccessTokenId,
          rawToken: null,
        };
      }

      const now = new Date();
      const attempt = await this.lockAttempt(transaction, recoveryAttemptId);
      if (
        attempt.status !== BookingGroupRecoveryAttemptStatus.VERIFIED ||
        attempt.expiresAt.getTime() <= now.getTime() ||
        !attempt.bookingGroupId ||
        !attempt.mobileNumberHash
      ) {
        this.fail();
      }

      const groupRows = await transaction.$queryRaw<
        Array<{
          id: string;
          practiceLocationId: string;
          serviceDate: Date;
          controllingMobileNumberHash: string | null;
        }>
      >(Prisma.sql`
        SELECT "id", "practiceLocationId", "serviceDate", "controllingMobileNumberHash"
        FROM "BookingGroup"
        WHERE "id" = ${attempt.bookingGroupId}
        FOR UPDATE
      `);
      const group = groupRows[0];
      if (
        !group ||
        group.practiceLocationId !== attempt.practiceLocationId ||
        group.serviceDate.getTime() !== attempt.serviceDate.getTime() ||
        group.controllingMobileNumberHash !== attempt.mobileNumberHash
      ) {
        this.fail();
      }
      const visibleMembers = await transaction.appointment.count({
        where: { bookingGroupId: group.id, anonymizedAt: null },
      });
      if (visibleMembers === 0) this.fail();

      const verifiedOtp = await transaction.otpVerification.findFirst({
        where: {
          bookingGroupRecoveryAttemptId: attempt.id,
          purpose: GROUP_RECOVERY_PURPOSE,
          verifiedAt: { not: null },
          consumedAt: null,
          invalidatedAt: null,
        },
        orderBy: { verifiedAt: 'desc' },
        select: { id: true, expiresAt: true },
      });
      if (!verifiedOtp || verifiedOtp.expiresAt.getTime() <= now.getTime()) this.fail();

      await transaction.bookingGroupAccessToken.updateMany({
        where: {
          bookingGroupId: group.id,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: null },
        },
        data: { revokedAt: now },
      });

      const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      const replacement = await transaction.bookingGroupAccessToken.create({
        data: {
          bookingGroupId: group.id,
          tokenHash,
          purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
          expiresAt: new Date(
            group.serviceDate.getTime() + TOKEN_EXPIRY_AFTER_SERVICE_DATE_MS,
          ),
        },
        select: { id: true, expiresAt: true },
      });

      await transaction.otpVerification.update({
        where: { id: verifiedOtp.id },
        data: { consumedAt: now, activeContextKey: null, otpHash: null },
      });
      await transaction.bookingGroupRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingGroupRecoveryAttemptStatus.COMPLETED,
          completedAt: now,
        },
      });

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType: CommandType.BOOKING_GROUP_RECOVERY_COMPLETE,
          requestFingerprint,
          practiceLocationId: group.practiceLocationId,
          serviceDate: group.serviceDate,
          bookingGroupId: group.id,
          bookingGroupRecoveryAttemptId: attempt.id,
          resultBookingGroupId: group.id,
          resultBookingGroupAccessTokenId: replacement.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
        },
      });

      return {
        replayed: false,
        bookingGroupId: group.id,
        replacementTokenRecordId: replacement.id,
        expiresAt: replacement.expiresAt,
        rawToken,
      };
    });
  }

  private async issueOtp(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    mobileNumberHash: string,
    now: Date,
  ): Promise<void> {
    const latest = await transaction.otpVerification.findFirst({
      where: {
        bookingGroupRecoveryAttemptId: recoveryAttemptId,
        purpose: GROUP_RECOVERY_PURPOSE,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new BadRequestException(GENERIC_FAILURE);
    }
    const challengeCount = await transaction.otpVerification.count({
      where: {
        bookingGroupRecoveryAttemptId: recoveryAttemptId,
        purpose: GROUP_RECOVERY_PURPOSE,
        createdAt: { gte: new Date(now.getTime() - CONTEXT_WINDOW_MS) },
      },
    });
    if (challengeCount >= MAX_CHALLENGES_PER_CONTEXT) {
      throw new BadRequestException(GENERIC_FAILURE);
    }

    const activeContextKey = this.activeContextKey(recoveryAttemptId);
    await transaction.otpVerification.updateMany({
      where: {
        bookingGroupRecoveryAttemptId: recoveryAttemptId,
        purpose: GROUP_RECOVERY_PURPOSE,
        consumedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now, activeContextKey: null, otpHash: null },
    });

    const rawOtp = this.otpGenerator.generate();
    await transaction.otpVerification.create({
      data: {
        bookingGroupRecoveryAttemptId: recoveryAttemptId,
        mobileNumberHash,
        mobileHashKeyVersion: 1,
        otpHash: this.otpService.hashOtp(
          recoveryAttemptId,
          GROUP_RECOVERY_PURPOSE,
          rawOtp,
        ),
        otpHashKeyVersion: 1,
        purpose: GROUP_RECOVERY_PURPOSE,
        activeContextKey,
        expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
      },
    });
  }

  private async contextFailureCount(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    now: Date,
  ): Promise<number> {
    const result = await transaction.otpVerification.aggregate({
      where: {
        bookingGroupRecoveryAttemptId: recoveryAttemptId,
        purpose: GROUP_RECOVERY_PURPOSE,
        createdAt: { gte: new Date(now.getTime() - CONTEXT_WINDOW_MS) },
      },
      _sum: { attemptCount: true },
    });
    return result._sum.attemptCount ?? 0;
  }

  private async lockAttempt(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
  ): Promise<LockedRecoveryAttempt> {
    const rows = await transaction.$queryRaw<LockedRecoveryAttempt[]>(Prisma.sql`
      SELECT
        "id", "practiceLocationId", "serviceDate", "mobileNumberHash",
        "bookingGroupId", "status", "expiresAt", "completedAt"
      FROM "BookingGroupRecoveryAttempt"
      WHERE "id" = ${recoveryAttemptId}
      FOR UPDATE
    `);
    return rows[0] ?? this.fail();
  }

  private assertPendingAttempt(attempt: LockedRecoveryAttempt, now: Date): void {
    if (
      attempt.status !== BookingGroupRecoveryAttemptStatus.PENDING_OTP ||
      attempt.completedAt ||
      attempt.expiresAt.getTime() <= now.getTime()
    ) {
      this.fail();
    }
  }

  private activeContextKey(recoveryAttemptId: string): string {
    return `BOOKING_GROUP_RECOVERY:${recoveryAttemptId}`;
  }

  private fail(): never {
    throw new UnauthorizedException(GENERIC_FAILURE);
  }
}
