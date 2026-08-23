import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BookingAccessTokenPurpose,
  BookingRecoveryAttemptStatus,
  CommandType,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  OtpPurpose,
  Prisma,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { OtpNotificationOutboxService } from '../notification/otp-notification-outbox.service';
import { OtpGenerator } from '../otp/otp.generator';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  RequestAppointmentRecoveryDto,
  VerifyAppointmentRecoveryOtpDto,
} from './dto/appointment-recovery.dto';

const RECOVERY_PURPOSE = OtpPurpose.APPOINTMENT_RECOVERY;
const OTP_LIFETIME_MS = 5 * 60 * 1000;
const RECOVERY_LIFETIME_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const CONTEXT_WINDOW_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_CHALLENGE = 5;
const MAX_FAILED_SUBMISSIONS_PER_CONTEXT = 10;
const MAX_CHALLENGES_PER_CONTEXT = 5;
const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_AFTER_SERVICE_DATE_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GENERIC_REQUEST_MESSAGE =
  'If the appointment can be recovered, verification will continue.';
const GENERIC_FAILURE = 'Appointment recovery is unavailable.';

type LockedAttempt = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberEncrypted: string | null;
  mobileNumberHash: string | null;
  candidateAppointmentId: string | null;
  status: BookingRecoveryAttemptStatus;
  expiresAt: Date;
  completedAt: Date | null;
};

type LockedOtp = {
  id: string;
  bookingRecoveryAttemptId: string | null;
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
export class AppointmentRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumber: MobileNumberService,
    private readonly otpGenerator: OtpGenerator,
    private readonly otpService: OtpService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly otpOutbox: OtpNotificationOutboxService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async request(dto: RequestAppointmentRecoveryDto) {
    const location = await this.prisma.practiceLocation.findUnique({
      where: { publicIdentifier: dto.practiceLocationPublicIdentifier },
      select: { id: true },
    });
    if (!location) {
      throw new BadRequestException(GENERIC_FAILURE);
    }

    const protectedMobile = this.mobileNumber.protect(dto.mobileNumber);
    const serviceDate = new Date(`${dto.serviceDate}T00:00:00.000Z`);
    const now = new Date();

    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.appointment.findMany({
        where: {
          practiceLocationId: location.id,
          serviceDate,
          mobileNumberHash: protectedMobile.hash,
          anonymizedAt: null,
          activeAppointmentKey: { not: null },
          bookingGroupId: null,
        },
        select: { id: true },
        take: 2,
      });
      const candidateAppointmentId =
        candidates.length === 1 ? candidates[0].id : null;

      const attempt = await transaction.bookingRecoveryAttempt.create({
        data: {
          practiceLocationId: location.id,
          serviceDate,
          mobileNumberEncrypted: protectedMobile.encrypted,
          mobileNumberHash: protectedMobile.hash,
          mobileHashKeyVersion: 1,
          mobileNumberLastFour: protectedMobile.lastFour,
          candidateAppointmentId,
          status: BookingRecoveryAttemptStatus.PENDING_OTP,
          expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS),
        },
        select: { id: true, expiresAt: true },
      });

      await this.issueOtp(
        transaction,
        attempt.id,
        location.id,
        protectedMobile.encrypted,
        protectedMobile.hash,
        now,
      );

      return {
        message: GENERIC_REQUEST_MESSAGE,
        recoveryAttemptId: attempt.id,
        expiresAt: attempt.expiresAt,
      };
    });
  }

  async resend(recoveryAttemptId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, recoveryAttemptId);
      this.assertPending(attempt, now);
      if (!attempt.mobileNumberHash || !attempt.mobileNumberEncrypted) {
        this.fail();
      }
      await this.issueOtp(
        transaction,
        attempt.id,
        attempt.practiceLocationId,
        attempt.mobileNumberEncrypted,
        attempt.mobileNumberHash,
        now,
      );
      return { message: GENERIC_REQUEST_MESSAGE, recoveryAttemptId };
    });
  }

  async verify(dto: VerifyAppointmentRecoveryOtpDto) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await this.lockAttempt(
        transaction,
        dto.recoveryAttemptId,
      );
      this.assertPending(attempt, now);
      const otp = await this.lockActiveOtp(transaction, attempt.id);
      if (!this.isUsableOtp(otp, attempt.id, now)) this.fail();

      const failures = await this.contextFailureCount(
        transaction,
        attempt.id,
        now,
      );
      if (failures >= MAX_FAILED_SUBMISSIONS_PER_CONTEXT) this.fail();

      const matches = this.otpService.verifyOtpHash(
        attempt.id,
        RECOVERY_PURPOSE,
        dto.otp,
        otp.otpHash!,
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
              ? {
                  invalidatedAt: now,
                  activeContextKey: null,
                  otpHash: null,
                  otpHashKeyVersion: null,
                }
              : {}),
          },
        });
        this.fail();
      }

      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: { verifiedAt: now },
      });
      await transaction.bookingRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingRecoveryAttemptStatus.VERIFIED,
          verifiedAt: now,
        },
      });

      const candidate = attempt.candidateAppointmentId
        ? await transaction.appointment.findFirst({
            where: {
              id: attempt.candidateAppointmentId,
              practiceLocationId: attempt.practiceLocationId,
              serviceDate: attempt.serviceDate,
              anonymizedAt: null,
              activeAppointmentKey: { not: null },
              bookingGroupId: null,
            },
            select: {
              bookingReference: true,
              queueNumber: true,
              serviceDate: true,
              firstName: true,
              lastName: true,
              practiceLocation: { select: { name: true } },
            },
          })
        : null;

      return {
        verified: true,
        recoveryAttemptId: attempt.id,
        candidate: candidate
          ? {
              bookingReference: candidate.bookingReference,
              queueNumber: candidate.queueNumber,
              serviceDate: candidate.serviceDate,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              practiceLocationName: candidate.practiceLocation.name,
            }
          : null,
      };
    });
  }

  async reject(recoveryAttemptId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const attempt = await this.lockAttempt(transaction, recoveryAttemptId);
      if (
        attempt.status !== BookingRecoveryAttemptStatus.VERIFIED ||
        attempt.expiresAt.getTime() <= now.getTime() ||
        attempt.completedAt
      ) {
        this.fail();
      }

      await transaction.otpVerification.updateMany({
        where: {
          bookingRecoveryAttemptId: attempt.id,
          purpose: RECOVERY_PURPOSE,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: {
          invalidatedAt: now,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      await transaction.bookingRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingRecoveryAttemptStatus.REJECTED,
          rejectedAt: now,
        },
      });
      return {
        rejected: true,
        guidance:
          'No appointment was changed. Contact the clinic if you still need help locating your booking.',
      };
    });
  }

  async confirmAndComplete(
    recoveryAttemptId: string,
    idempotencyKey: string | undefined,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.COMPLETE_APPOINTMENT_RECOVERY,
      scope: { bookingRecoveryAttemptId: recoveryAttemptId },
    });
    const requestFingerprint = this.idempotency.fingerprint({
      recoveryAttemptId,
      candidateConfirmation: true,
    });

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay?.resultAppointmentId) {
        const appointment = await transaction.appointment.findUnique({
          where: { id: replay.resultAppointmentId },
          select: { bookingReference: true, queueNumber: true },
        });
        if (!appointment) this.fail();
        return { replayed: true, appointment, rawToken: null, expiresAt: null };
      }

      const now = new Date();
      let attempt = await this.lockAttempt(transaction, recoveryAttemptId);
      if (
        attempt.status !== BookingRecoveryAttemptStatus.VERIFIED ||
        attempt.expiresAt.getTime() <= now.getTime() ||
        !attempt.candidateAppointmentId ||
        !attempt.mobileNumberEncrypted
      ) {
        this.fail();
      }

      await transaction.bookingRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingRecoveryAttemptStatus.CANDIDATE_CONFIRMED,
          candidateConfirmedAt: now,
        },
      });
      attempt = {
        ...attempt,
        status: BookingRecoveryAttemptStatus.CANDIDATE_CONFIRMED,
      };

      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          bookingReference: string;
          practiceLocationId: string;
          serviceDate: Date;
          queueNumber: number;
          mobileNumberHash: string | null;
          anonymizedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT "id", "bookingReference", "practiceLocationId", "serviceDate",
               "queueNumber", "mobileNumberHash", "anonymizedAt"
        FROM "Appointment"
        WHERE "id" = ${attempt.candidateAppointmentId}
        FOR UPDATE
      `);
      const appointment = rows[0];
      if (
        !appointment ||
        appointment.anonymizedAt ||
        appointment.practiceLocationId !== attempt.practiceLocationId ||
        appointment.serviceDate.getTime() !== attempt.serviceDate.getTime() ||
        appointment.mobileNumberHash !== attempt.mobileNumberHash
      ) {
        this.fail();
      }

      const verifiedOtp = await transaction.otpVerification.findFirst({
        where: {
          bookingRecoveryAttemptId: attempt.id,
          purpose: RECOVERY_PURPOSE,
          verifiedAt: { not: null },
          consumedAt: null,
          invalidatedAt: null,
        },
        orderBy: { verifiedAt: 'desc' },
        select: { id: true, expiresAt: true },
      });
      if (!verifiedOtp || verifiedOtp.expiresAt.getTime() <= now.getTime()) {
        this.fail();
      }

      await transaction.bookingAccessToken.updateMany({
        where: {
          appointmentId: appointment.id,
          tokenHash: { not: null },
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
      const tokenHash = createHash('sha256')
        .update(rawToken, 'utf8')
        .digest('hex');
      const expiresAt = new Date(
        appointment.serviceDate.getTime() + TOKEN_EXPIRY_AFTER_SERVICE_DATE_MS,
      );
      const replacement = await transaction.bookingAccessToken.create({
        data: {
          appointmentId: appointment.id,
          tokenHash,
          purpose: BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING,
          expiresAt,
        },
        select: { id: true },
      });
      void replacement;

      const completedAt = new Date();
      await transaction.otpVerification.update({
        where: { id: verifiedOtp.id },
        data: {
          consumedAt: completedAt,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      await transaction.bookingRecoveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BookingRecoveryAttemptStatus.COMPLETED,
          completedAt,
        },
      });

      const completion = this.idempotency.completionTimes(completedAt);
      const command = await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType: CommandType.COMPLETE_APPOINTMENT_RECOVERY,
          requestFingerprint,
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          bookingRecoveryAttemptId: attempt.id,
          resultAppointmentId: appointment.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: completion.completedAt,
        },
        select: { id: true },
      });

      const message = this.buildRecoveryMessage(
        appointment.bookingReference,
        rawToken,
      );
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: createHash('sha256')
            .update(
              `${NotificationType.SECURITY_NOTIFICATION}|${commandIdentityKey}|${appointment.id}`,
            )
            .digest('hex'),
          notificationType: NotificationType.SECURITY_NOTIFICATION,
          channel: NotificationChannel.SMS,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: appointment.practiceLocationId,
          appointmentId: appointment.id,
          commandIdempotencyId: command.id,
          recipientMobileEncrypted: attempt.mobileNumberEncrypted,
          recipientEmailEncrypted: null,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(message),
          providerIdempotencyKey: `appointment-recovery:${commandIdentityKey}`,
          attemptCount: 0,
          nextAttemptAt: completedAt,
          expiresAt: new Date(
            completedAt.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
          ),
          createdAt: completedAt,
        },
      });

      return {
        replayed: false,
        appointment: {
          bookingReference: appointment.bookingReference,
          queueNumber: appointment.queueNumber,
        },
        rawToken,
        expiresAt,
      };
    });
  }

  private async issueOtp(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    practiceLocationId: string,
    mobileNumberEncrypted: string,
    mobileNumberHash: string,
    now: Date,
  ): Promise<void> {
    const latest = await transaction.otpVerification.findFirst({
      where: {
        bookingRecoveryAttemptId: recoveryAttemptId,
        purpose: RECOVERY_PURPOSE,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      latest &&
      now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(GENERIC_FAILURE);
    }
    const challengeCount = await transaction.otpVerification.count({
      where: {
        bookingRecoveryAttemptId: recoveryAttemptId,
        purpose: RECOVERY_PURPOSE,
        createdAt: { gte: new Date(now.getTime() - CONTEXT_WINDOW_MS) },
      },
    });
    if (challengeCount >= MAX_CHALLENGES_PER_CONTEXT) {
      throw new BadRequestException(GENERIC_FAILURE);
    }

    await transaction.otpVerification.updateMany({
      where: {
        bookingRecoveryAttemptId: recoveryAttemptId,
        purpose: RECOVERY_PURPOSE,
        consumedAt: null,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: now,
        activeContextKey: null,
        otpHash: null,
        otpHashKeyVersion: null,
      },
    });

    const rawOtp = this.otpGenerator.generate();
    const otp = await transaction.otpVerification.create({
      data: {
        bookingRecoveryAttemptId: recoveryAttemptId,
        mobileNumberHash,
        mobileHashKeyVersion: 1,
        otpHash: this.otpService.hashOtp(
          recoveryAttemptId,
          RECOVERY_PURPOSE,
          rawOtp,
        ),
        otpHashKeyVersion: 1,
        purpose: RECOVERY_PURPOSE,
        activeContextKey: this.activeContextKey(recoveryAttemptId),
        expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
      },
      select: { id: true },
    });

    await this.otpOutbox.createBookingOtpOutbox(transaction, {
      otpVerificationId: otp.id,
      practiceLocationId,
      recipientMobileEncrypted: mobileNumberEncrypted,
      otp: rawOtp,
      createdAt: now,
    });
  }

  private async lockAttempt(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
  ): Promise<LockedAttempt> {
    const rows = await transaction.$queryRaw<LockedAttempt[]>(Prisma.sql`
      SELECT "id", "practiceLocationId", "serviceDate", "mobileNumberEncrypted",
             "mobileNumberHash", "candidateAppointmentId", "status", "expiresAt", "completedAt"
      FROM "BookingRecoveryAttempt"
      WHERE "id" = ${recoveryAttemptId}
      FOR UPDATE
    `);
    return rows[0] ?? this.fail();
  }

  private async lockActiveOtp(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
  ): Promise<LockedOtp> {
    const rows = await transaction.$queryRaw<LockedOtp[]>(Prisma.sql`
      SELECT "id", "bookingRecoveryAttemptId", "otpHash", "purpose",
             "activeContextKey", "attemptCount", "expiresAt", "verifiedAt",
             "consumedAt", "invalidatedAt"
      FROM "OtpVerification"
      WHERE "activeContextKey" = ${this.activeContextKey(recoveryAttemptId)}
      FOR UPDATE
    `);
    return rows[0] ?? this.fail();
  }

  private isUsableOtp(
    otp: LockedOtp,
    recoveryAttemptId: string,
    now: Date,
  ): boolean {
    return Boolean(
      otp.bookingRecoveryAttemptId === recoveryAttemptId &&
      otp.purpose === RECOVERY_PURPOSE &&
      !otp.verifiedAt &&
      !otp.consumedAt &&
      !otp.invalidatedAt &&
      otp.otpHash &&
      otp.attemptCount < MAX_ATTEMPTS_PER_CHALLENGE &&
      otp.expiresAt.getTime() > now.getTime(),
    );
  }

  private async contextFailureCount(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    now: Date,
  ): Promise<number> {
    const result = await transaction.otpVerification.aggregate({
      where: {
        bookingRecoveryAttemptId: recoveryAttemptId,
        purpose: RECOVERY_PURPOSE,
        createdAt: { gte: new Date(now.getTime() - CONTEXT_WINDOW_MS) },
      },
      _sum: { attemptCount: true },
    });
    return result._sum.attemptCount ?? 0;
  }

  private assertPending(attempt: LockedAttempt, now: Date): void {
    if (
      attempt.status !== BookingRecoveryAttemptStatus.PENDING_OTP ||
      attempt.completedAt ||
      attempt.expiresAt.getTime() <= now.getTime()
    ) {
      this.fail();
    }
  }

  private activeContextKey(recoveryAttemptId: string): string {
    return `APPOINTMENT_RECOVERY:${recoveryAttemptId}`;
  }

  private buildRecoveryMessage(
    bookingReference: string,
    rawToken: string,
  ): string {
    const baseUrl = process.env.PUBLIC_APP_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new InternalServerErrorException(
        'Public application base URL is not configured.',
      );
    }
    const secureLink = `${baseUrl}/booking/access#token=${encodeURIComponent(rawToken)}`;
    return [
      'Clinic Queueing appointment access was recovered.',
      `Booking reference: ${bookingReference}.`,
      `Secure access: ${secureLink}`,
      'If you did not request this, contact the clinic.',
    ].join(' ');
  }

  private fail(): never {
    throw new UnauthorizedException(GENERIC_FAILURE);
  }
}
