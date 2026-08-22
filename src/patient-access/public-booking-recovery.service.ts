import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AppointmentCancelledByType,
  BookingGroupRecoveryAttemptStatus,
  BookingRecoveryAttemptStatus,
  OtpPurpose,
  Prisma,
} from '../../generated/prisma/client';
import { ActiveBookingIdentityService } from '../booking/active-booking-identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AppointmentRecoveryService } from './appointment-recovery.service';
import { BookingGroupRecoveryService } from './booking-group-recovery.service';
import {
  RequestAppointmentRecoveryDto,
  VerifyAppointmentRecoveryOtpDto,
} from './dto/appointment-recovery.dto';

const ACTIVE_STATUSES = [
  'WAITING',
  'CALLED',
  'TEMPORARILY_ABSENT',
  'OUT_FOR_PROCEDURE',
] as const;
const REPLACEMENT_AUTHORITY_LIFETIME_MS = 10 * 60 * 1000;
const REPLACEMENT_REASON =
  'Replaced by the verified controller of the public booking mobile number.';
const GENERIC_REQUEST_MESSAGE =
  'If the booking can be recovered, verification will continue.';
const GENERIC_FAILURE = 'Booking recovery is unavailable.';

type RecoveryKind = 'INDIVIDUAL' | 'BOOKING_GROUP';

type ReplacementScope = {
  kind: RecoveryKind;
  recoveryAttemptId: string;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberHash: string;
  expiresAt: Date;
};

@Injectable()
export class PublicBookingRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumber: MobileNumberService,
    private readonly appointmentRecovery: AppointmentRecoveryService,
    private readonly bookingGroupRecovery: BookingGroupRecoveryService,
    private readonly activeBookingIdentity: ActiveBookingIdentityService,
  ) {}

  async request(dto: RequestAppointmentRecoveryDto) {
    const location = await this.prisma.practiceLocation.findUnique({
      where: { publicIdentifier: dto.practiceLocationPublicIdentifier },
      select: { id: true },
    });
    if (!location) {
      return this.appointmentRecovery.request(dto);
    }

    const protectedMobile = this.mobileNumber.protect(dto.mobileNumber);
    const serviceDate = new Date(`${dto.serviceDate}T00:00:00.000Z`);
    const [individualCount, groupCount] = await Promise.all([
      this.prisma.appointment.count({
        where: {
          practiceLocationId: location.id,
          serviceDate,
          mobileNumberHash: protectedMobile.hash,
          bookingGroupId: null,
          anonymizedAt: null,
          activeAppointmentKey: { not: null },
          status: { in: [...ACTIVE_STATUSES] },
        },
      }),
      this.prisma.bookingGroup.count({
        where: {
          practiceLocationId: location.id,
          serviceDate,
          controllingMobileNumberHash: protectedMobile.hash,
          appointments: {
            some: {
              anonymizedAt: null,
              status: { in: [...ACTIVE_STATUSES] },
            },
          },
        },
      }),
    ]);

    const result =
      groupCount === 1 && individualCount === 0
        ? await this.bookingGroupRecovery.request(dto)
        : await this.appointmentRecovery.request(dto);

    return {
      message: GENERIC_REQUEST_MESSAGE,
      recoveryAttemptId: result.recoveryAttemptId,
      expiresAt: result.expiresAt,
    };
  }

  async resend(recoveryAttemptId: string) {
    const kind = await this.resolveAttemptKind(recoveryAttemptId);
    const result =
      kind === 'BOOKING_GROUP'
        ? await this.bookingGroupRecovery.resend(recoveryAttemptId)
        : await this.appointmentRecovery.resend(recoveryAttemptId);
    return {
      message: GENERIC_REQUEST_MESSAGE,
      recoveryAttemptId: result.recoveryAttemptId,
    };
  }

  async verify(dto: VerifyAppointmentRecoveryOtpDto) {
    const kind = await this.resolveAttemptKind(dto.recoveryAttemptId);
    if (kind === 'INDIVIDUAL') {
      const result = await this.appointmentRecovery.verify(dto);
      return {
        verified: result.verified,
        recoveryAttemptId: result.recoveryAttemptId,
        contextKind: result.candidate ? ('INDIVIDUAL' as const) : null,
        candidate: result.candidate,
      };
    }

    const verified = await this.bookingGroupRecovery.verify(dto);
    const attempt = await this.prisma.bookingGroupRecoveryAttempt.findUnique({
      where: { id: dto.recoveryAttemptId },
      select: {
        bookingGroupId: true,
        practiceLocationId: true,
        serviceDate: true,
      },
    });
    const group = attempt?.bookingGroupId
      ? await this.prisma.bookingGroup.findFirst({
          where: {
            id: attempt.bookingGroupId,
            practiceLocationId: attempt.practiceLocationId,
            serviceDate: attempt.serviceDate,
            appointments: {
              some: {
                anonymizedAt: null,
                status: { in: [...ACTIVE_STATUSES] },
              },
            },
          },
          select: {
            id: true,
            serviceDate: true,
            practiceLocation: { select: { name: true } },
            appointments: {
              where: {
                anonymizedAt: null,
                status: { in: [...ACTIVE_STATUSES] },
              },
              orderBy: { queueNumber: 'asc' },
              select: {
                bookingReference: true,
                queueNumber: true,
                firstName: true,
                lastName: true,
                status: true,
              },
            },
          },
        })
      : null;

    return {
      verified: verified.verified,
      recoveryAttemptId: verified.recoveryAttemptId,
      contextKind: group ? ('BOOKING_GROUP' as const) : null,
      candidate: group
        ? {
            bookingGroupId: group.id,
            serviceDate: group.serviceDate,
            practiceLocationName: group.practiceLocation.name,
            appointments: group.appointments,
          }
        : null,
    };
  }

  async useExisting(
    recoveryAttemptId: string,
    idempotencyKey: string | undefined,
  ) {
    const kind = await this.resolveAttemptKind(recoveryAttemptId);
    if (kind === 'BOOKING_GROUP') {
      return {
        kind,
        result: await this.bookingGroupRecovery.complete(
          recoveryAttemptId,
          idempotencyKey,
        ),
      };
    }
    return {
      kind,
      result: await this.appointmentRecovery.confirmAndComplete(
        recoveryAttemptId,
        idempotencyKey,
      ),
    };
  }

  async authorizeReplacement(recoveryAttemptId: string) {
    const kind = await this.resolveAttemptKind(recoveryAttemptId);
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const scope = await this.lockVerifiedReplacementScope(
        transaction,
        recoveryAttemptId,
        kind,
        now,
      );
      const replacementKey = this.replacementContextKey(recoveryAttemptId);
      const otp = await this.lockVerifiedRecoveryOtp(
        transaction,
        recoveryAttemptId,
        kind,
      );

      if (otp.activeContextKey === replacementKey) {
        if (otp.expiresAt.getTime() <= now.getTime()) this.fail();
        return {
          replacementAuthorized: true,
          replacementRecoveryAttemptId: recoveryAttemptId,
          expiresAt: otp.expiresAt,
          replayed: true,
        };
      }

      const activeAppointmentKey =
        this.activeBookingIdentity.deriveAppointmentKey(
          scope.mobileNumberHash,
          scope.practiceLocationId,
          scope.serviceDate,
        );
      await this.activeBookingIdentity.acquireAppointmentScopeLock(
        transaction,
        activeAppointmentKey,
      );

      const cancelledQueueNumbers =
        kind === 'INDIVIDUAL'
          ? await this.cancelIndividualContext(
              transaction,
              scope,
              activeAppointmentKey,
              now,
            )
          : await this.cancelGroupContext(transaction, scope, now);

      const expiresAt = new Date(
        Math.min(
          scope.expiresAt.getTime(),
          now.getTime() + REPLACEMENT_AUTHORITY_LIFETIME_MS,
        ),
      );
      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: {
          activeContextKey: replacementKey,
          expiresAt,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });

      return {
        replacementAuthorized: true,
        replacementRecoveryAttemptId: recoveryAttemptId,
        expiresAt,
        replayed: false,
        cancelledContext: {
          kind,
          queueNumbers: cancelledQueueNumbers,
        },
      };
    });
  }

  async validateReplacementAuthority(input: {
    recoveryAttemptId: string;
    mobileNumberHash: string;
    practiceLocationId: string;
    serviceDate: Date;
  }): Promise<void> {
    const kind = await this.resolveAttemptKind(input.recoveryAttemptId);
    await this.prisma.$transaction(async (transaction) => {
      const scope = await this.lockVerifiedReplacementScope(
        transaction,
        input.recoveryAttemptId,
        kind,
        new Date(),
      );
      const otp = await this.lockVerifiedRecoveryOtp(
        transaction,
        input.recoveryAttemptId,
        kind,
      );
      if (
        otp.activeContextKey !==
          this.replacementContextKey(input.recoveryAttemptId) ||
        otp.expiresAt.getTime() <= Date.now() ||
        scope.mobileNumberHash !== input.mobileNumberHash ||
        scope.practiceLocationId !== input.practiceLocationId ||
        scope.serviceDate.getTime() !== input.serviceDate.getTime()
      ) {
        this.fail();
      }
    });
  }

  async bindReplacementAuthorityToDraft(input: {
    recoveryAttemptId: string;
    bookingDraftId: string;
    mobileNumberHash: string;
    practiceLocationId: string;
    serviceDate: Date;
  }): Promise<{ expiresAt: Date }> {
    const kind = await this.resolveAttemptKind(input.recoveryAttemptId);
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const scope = await this.lockVerifiedReplacementScope(
        transaction,
        input.recoveryAttemptId,
        kind,
        now,
      );
      const otp = await this.lockVerifiedRecoveryOtp(
        transaction,
        input.recoveryAttemptId,
        kind,
      );
      if (
        otp.activeContextKey !==
          this.replacementContextKey(input.recoveryAttemptId) ||
        otp.expiresAt.getTime() <= now.getTime() ||
        scope.mobileNumberHash !== input.mobileNumberHash ||
        scope.practiceLocationId !== input.practiceLocationId ||
        scope.serviceDate.getTime() !== input.serviceDate.getTime()
      ) {
        this.fail();
      }

      const draftRows = await transaction.$queryRaw<
        Array<{
          id: string;
          practiceLocationId: string;
          serviceDate: Date;
          mobileNumberHash: string | null;
          status: string;
          expiresAt: Date;
        }>
      >(Prisma.sql`
        SELECT "id", "practiceLocationId", "serviceDate", "mobileNumberHash",
               "status", "expiresAt"
        FROM "BookingDraft"
        WHERE "id" = ${input.bookingDraftId}
        FOR UPDATE
      `);
      const draft = draftRows[0];
      if (
        !draft ||
        draft.status !== 'PENDING_OTP' ||
        draft.mobileNumberHash !== input.mobileNumberHash ||
        draft.practiceLocationId !== input.practiceLocationId ||
        draft.serviceDate.getTime() !== input.serviceDate.getTime()
      ) {
        this.fail();
      }

      const expiresAt = new Date(
        Math.min(draft.expiresAt.getTime(), otp.expiresAt.getTime()),
      );
      await transaction.otpVerification.create({
        data: {
          bookingDraftId: draft.id,
          mobileNumberHash: input.mobileNumberHash,
          mobileHashKeyVersion: 1,
          otpHash: null,
          otpHashKeyVersion: null,
          purpose: OtpPurpose.BOOKING,
          activeContextKey: `BOOKING:${draft.id}`,
          expiresAt,
          verifiedAt: now,
          createdAt: now,
        },
      });
      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: {
          consumedAt: now,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      if (kind === 'INDIVIDUAL') {
        await transaction.bookingRecoveryAttempt.update({
          where: { id: input.recoveryAttemptId },
          data: {
            status: BookingRecoveryAttemptStatus.COMPLETED,
            completedAt: now,
          },
        });
      } else {
        await transaction.bookingGroupRecoveryAttempt.update({
          where: { id: input.recoveryAttemptId },
          data: {
            status: BookingGroupRecoveryAttemptStatus.COMPLETED,
            completedAt: now,
          },
        });
      }
      await transaction.bookingDraft.update({
        where: { id: draft.id },
        data: { expiresAt },
      });
      return { expiresAt };
    });
  }

  private async resolveAttemptKind(
    recoveryAttemptId: string,
  ): Promise<RecoveryKind> {
    const [individual, group] = await Promise.all([
      this.prisma.bookingRecoveryAttempt.findUnique({
        where: { id: recoveryAttemptId },
        select: { id: true },
      }),
      this.prisma.bookingGroupRecoveryAttempt.findUnique({
        where: { id: recoveryAttemptId },
        select: { id: true },
      }),
    ]);
    if (individual && !group) return 'INDIVIDUAL';
    if (group && !individual) return 'BOOKING_GROUP';
    this.fail();
  }

  private async lockVerifiedReplacementScope(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    kind: RecoveryKind,
    now: Date,
  ): Promise<ReplacementScope> {
    if (kind === 'INDIVIDUAL') {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          practiceLocationId: string;
          serviceDate: Date;
          mobileNumberHash: string | null;
          candidateAppointmentId: string | null;
          status: BookingRecoveryAttemptStatus;
          expiresAt: Date;
        }>
      >(Prisma.sql`
        SELECT "id", "practiceLocationId", "serviceDate", "mobileNumberHash",
               "candidateAppointmentId", "status", "expiresAt"
        FROM "BookingRecoveryAttempt"
        WHERE "id" = ${recoveryAttemptId}
        FOR UPDATE
      `);
      const attempt = rows[0];
      if (
        !attempt ||
        attempt.status !== BookingRecoveryAttemptStatus.VERIFIED ||
        !attempt.mobileNumberHash ||
        !attempt.candidateAppointmentId ||
        attempt.expiresAt.getTime() <= now.getTime()
      ) {
        this.fail();
      }
      return {
        kind,
        recoveryAttemptId,
        practiceLocationId: attempt.practiceLocationId,
        serviceDate: attempt.serviceDate,
        mobileNumberHash: attempt.mobileNumberHash,
        expiresAt: attempt.expiresAt,
      };
    }

    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        practiceLocationId: string;
        serviceDate: Date;
        mobileNumberHash: string | null;
        bookingGroupId: string | null;
        status: BookingGroupRecoveryAttemptStatus;
        expiresAt: Date;
      }>
    >(Prisma.sql`
      SELECT "id", "practiceLocationId", "serviceDate", "mobileNumberHash",
             "bookingGroupId", "status", "expiresAt"
      FROM "BookingGroupRecoveryAttempt"
      WHERE "id" = ${recoveryAttemptId}
      FOR UPDATE
    `);
    const attempt = rows[0];
    if (
      !attempt ||
      attempt.status !== BookingGroupRecoveryAttemptStatus.VERIFIED ||
      !attempt.mobileNumberHash ||
      !attempt.bookingGroupId ||
      attempt.expiresAt.getTime() <= now.getTime()
    ) {
      this.fail();
    }
    return {
      kind,
      recoveryAttemptId,
      practiceLocationId: attempt.practiceLocationId,
      serviceDate: attempt.serviceDate,
      mobileNumberHash: attempt.mobileNumberHash,
      expiresAt: attempt.expiresAt,
    };
  }

  private async lockVerifiedRecoveryOtp(
    transaction: Prisma.TransactionClient,
    recoveryAttemptId: string,
    kind: RecoveryKind,
  ) {
    const replacementKey = this.replacementContextKey(recoveryAttemptId);
    const normalKey =
      kind === 'INDIVIDUAL'
        ? `APPOINTMENT_RECOVERY:${recoveryAttemptId}`
        : `BOOKING_GROUP_RECOVERY:${recoveryAttemptId}`;
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        verifiedAt: Date | null;
        consumedAt: Date | null;
        invalidatedAt: Date | null;
        activeContextKey: string | null;
        expiresAt: Date;
      }>
    >(Prisma.sql`
      SELECT "id", "verifiedAt", "consumedAt", "invalidatedAt",
             "activeContextKey", "expiresAt"
      FROM "OtpVerification"
      WHERE ${
        kind === 'INDIVIDUAL'
          ? Prisma.sql`"bookingRecoveryAttemptId" = ${recoveryAttemptId}`
          : Prisma.sql`"bookingGroupRecoveryAttemptId" = ${recoveryAttemptId}`
      }
        AND "activeContextKey" IN (${normalKey}, ${replacementKey})
      LIMIT 1
      FOR UPDATE
    `);
    const otp = rows[0];
    if (
      !otp ||
      !otp.verifiedAt ||
      otp.consumedAt ||
      otp.invalidatedAt ||
      !otp.activeContextKey
    ) {
      this.fail();
    }
    return otp;
  }

  private async cancelIndividualContext(
    transaction: Prisma.TransactionClient,
    scope: ReplacementScope,
    activeAppointmentKey: string,
    now: Date,
  ): Promise<number[]> {
    const appointment = await transaction.appointment.findFirst({
      where: {
        activeAppointmentKey,
        bookingGroupId: null,
        mobileNumberHash: scope.mobileNumberHash,
        practiceLocationId: scope.practiceLocationId,
        serviceDate: scope.serviceDate,
        status: { in: [...ACTIVE_STATUSES] },
        anonymizedAt: null,
      },
      select: { id: true, queueNumber: true },
    });
    if (!appointment) this.fail();
    await transaction.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        terminalAt: now,
        cancelledByType: AppointmentCancelledByType.PATIENT,
        cancellationReason: REPLACEMENT_REASON,
        servingOrderKey: null,
        waitingPlacementType: null,
        activeAppointmentKey: null,
      },
    });
    return [appointment.queueNumber];
  }

  private async cancelGroupContext(
    transaction: Prisma.TransactionClient,
    scope: ReplacementScope,
    now: Date,
  ): Promise<number[]> {
    const group = await transaction.bookingGroup.findFirst({
      where: {
        practiceLocationId: scope.practiceLocationId,
        serviceDate: scope.serviceDate,
        controllingMobileNumberHash: scope.mobileNumberHash,
        appointments: {
          some: {
            status: { in: [...ACTIVE_STATUSES] },
            anonymizedAt: null,
          },
        },
      },
      select: {
        id: true,
        appointments: {
          where: {
            status: { in: [...ACTIVE_STATUSES] },
            anonymizedAt: null,
          },
          select: { queueNumber: true },
        },
      },
    });
    if (!group) this.fail();
    await transaction.appointment.updateMany({
      where: {
        bookingGroupId: group.id,
        status: { in: [...ACTIVE_STATUSES] },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        terminalAt: now,
        cancelledByType: AppointmentCancelledByType.PATIENT,
        cancellationReason: REPLACEMENT_REASON,
        servingOrderKey: null,
        waitingPlacementType: null,
        activeAppointmentKey: null,
      },
    });
    await transaction.bookingGroup.update({
      where: { id: group.id },
      data: { servingProtectionEndedAt: now },
    });
    return group.appointments.map((appointment) => appointment.queueNumber);
  }

  private replacementContextKey(recoveryAttemptId: string): string {
    return `RECOVERY_REPLACEMENT:${recoveryAttemptId}`;
  }

  private fail(): never {
    throw new UnauthorizedException(GENERIC_FAILURE);
  }
}
