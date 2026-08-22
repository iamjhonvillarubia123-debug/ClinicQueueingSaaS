import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentCancelledByType,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveBookingIdentityService } from './active-booking-identity.service';

const ACTIVE_STATUSES = [
  'WAITING',
  'CALLED',
  'TEMPORARILY_ABSENT',
  'OUT_FOR_PROCEDURE',
] as const;
const REPLACEMENT_AUTHORITY_LIFETIME_MS = 10 * 60 * 1000;
const REPLACEMENT_REASON =
  'Replaced by the verified controller of the public booking mobile number.';

type LockedDraft = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberHash: string | null;
  status: 'PENDING_OTP' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  activeDraftKey: string | null;
};

type LockedOtp = {
  id: string;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  activeContextKey: string | null;
  expiresAt: Date;
};

@Injectable()
export class PublicBookingReplacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activeBookingIdentity: ActiveBookingIdentityService,
  ) {}

  async describeDuplicate(bookingDraftId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const draft = await this.lockDraft(transaction, bookingDraftId);
      this.assertDraftUsable(draft, now);
      await this.lockVerifiedBookingOtp(transaction, draft.id, now, false);
      const activeKey = this.activeBookingIdentity.deriveAppointmentKey(
        this.requireMobileHash(draft),
        draft.practiceLocationId,
        draft.serviceDate,
      );
      await this.activeBookingIdentity.acquireAppointmentScopeLock(
        transaction,
        activeKey,
      );
      const context = await this.findActiveContext(transaction, draft, activeKey);
      if (!context) {
        return { duplicate: false as const, replacementAuthorized: false };
      }
      return {
        duplicate: true as const,
        replacementAuthorized: false,
        context,
      };
    });
  }

  async authorizeReplacement(bookingDraftId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const draft = await this.lockDraft(transaction, bookingDraftId);
      this.assertDraftUsable(draft, now);
      const otp = await this.lockVerifiedBookingOtp(
        transaction,
        draft.id,
        now,
        true,
      );

      const replacementKey = this.replacementContextKey(draft.id);
      if (otp.activeContextKey === replacementKey) {
        if (otp.expiresAt.getTime() <= now.getTime()) {
          throw new ConflictException(
            'Verified replacement authority has expired. Verify the mobile number again.',
          );
        }
        return {
          replacementAuthorized: true,
          expiresAt: otp.expiresAt,
          replayed: true,
        };
      }

      const mobileHash = this.requireMobileHash(draft);
      const activeKey = this.activeBookingIdentity.deriveAppointmentKey(
        mobileHash,
        draft.practiceLocationId,
        draft.serviceDate,
      );
      await this.activeBookingIdentity.acquireAppointmentScopeLock(
        transaction,
        activeKey,
      );
      const context = await this.findActiveContext(transaction, draft, activeKey);
      if (!context) {
        throw new ConflictException(
          'There is no active public booking to replace for this verified mobile scope.',
        );
      }

      if (context.kind === 'INDIVIDUAL') {
        await transaction.appointment.update({
          where: { id: context.appointment.id },
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
      } else {
        await transaction.appointment.updateMany({
          where: {
            bookingGroupId: context.bookingGroup.id,
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
          where: { id: context.bookingGroup.id },
          data: { servingProtectionEndedAt: now },
        });
      }

      const expiresAt = new Date(
        Math.min(
          draft.expiresAt.getTime(),
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
      await transaction.bookingDraft.update({
        where: { id: draft.id },
        data: { expiresAt },
      });

      return {
        replacementAuthorized: true,
        expiresAt,
        replayed: false,
        cancelledContext:
          context.kind === 'INDIVIDUAL'
            ? {
                kind: context.kind,
                bookingReference: context.appointment.bookingReference,
                queueNumbers: [context.appointment.queueNumber],
              }
            : {
                kind: context.kind,
                bookingGroupId: context.bookingGroup.id,
                queueNumbers: context.bookingGroup.appointments.map(
                  (appointment) => appointment.queueNumber,
                ),
              },
      };
    });
  }

  async prepareForConfirmation(bookingDraftId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const draft = await this.lockDraft(transaction, bookingDraftId);
      this.assertDraftUsable(draft, now);
      const otp = await this.lockVerifiedBookingOtp(
        transaction,
        draft.id,
        now,
        true,
      );
      if (otp.activeContextKey !== this.replacementContextKey(draft.id)) {
        return;
      }
      if (otp.expiresAt.getTime() <= now.getTime()) {
        throw new ConflictException(
          'Verified replacement authority has expired. Verify the mobile number again.',
        );
      }
      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: { activeContextKey: `BOOKING:${draft.id}` },
      });
    });
  }

  private async findActiveContext(
    transaction: Prisma.TransactionClient,
    draft: LockedDraft,
    activeAppointmentKey: string,
  ) {
    const individual = await transaction.appointment.findFirst({
      where: {
        activeAppointmentKey,
        bookingGroupId: null,
        status: { in: [...ACTIVE_STATUSES] },
        anonymizedAt: null,
      },
      select: {
        id: true,
        bookingReference: true,
        queueNumber: true,
        serviceDate: true,
        firstName: true,
        lastName: true,
        practiceLocation: { select: { name: true } },
      },
    });

    const groups = await transaction.bookingGroup.findMany({
      where: {
        controllingMobileNumberHash: this.requireMobileHash(draft),
        practiceLocationId: draft.practiceLocationId,
        serviceDate: draft.serviceDate,
        appointments: {
          some: {
            status: { in: [...ACTIVE_STATUSES] },
            anonymizedAt: null,
          },
        },
      },
      select: {
        id: true,
        serviceDate: true,
        practiceLocation: { select: { name: true } },
        appointments: {
          where: {
            status: { in: [...ACTIVE_STATUSES] },
            anonymizedAt: null,
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
      take: 2,
    });

    const contextCount = (individual ? 1 : 0) + groups.length;
    if (contextCount > 1) {
      throw new ConflictException(
        'Public booking uniqueness is inconsistent for this verified mobile scope.',
      );
    }
    if (individual) {
      return { kind: 'INDIVIDUAL' as const, appointment: individual };
    }
    const group = groups[0];
    if (group) {
      return { kind: 'BOOKING_GROUP' as const, bookingGroup: group };
    }
    return null;
  }

  private async lockDraft(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
  ): Promise<LockedDraft> {
    const rows = await transaction.$queryRaw<LockedDraft[]>(Prisma.sql`
      SELECT "id", "practiceLocationId", "serviceDate", "mobileNumberHash",
             "status", "expiresAt", "consumedAt", "cancelledAt", "activeDraftKey"
      FROM "BookingDraft"
      WHERE "id" = ${bookingDraftId}
      FOR UPDATE
    `);
    const draft = rows[0];
    if (!draft) {
      throw new NotFoundException('Booking draft is not available.');
    }
    return draft;
  }

  private async lockVerifiedBookingOtp(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    now: Date,
    acceptReplacementAuthority: boolean,
  ): Promise<LockedOtp> {
    const bookingKey = `BOOKING:${bookingDraftId}`;
    const replacementKey = this.replacementContextKey(bookingDraftId);
    const rows = await transaction.$queryRaw<LockedOtp[]>(Prisma.sql`
      SELECT "id", "verifiedAt", "consumedAt", "invalidatedAt",
             "activeContextKey", "expiresAt"
      FROM "OtpVerification"
      WHERE "bookingDraftId" = ${bookingDraftId}
        AND "purpose" = 'BOOKING'
        AND "activeContextKey" IN (${bookingKey}, ${replacementKey})
      LIMIT 1
      FOR UPDATE
    `);
    const otp = rows[0];
    if (
      !otp ||
      !otp.verifiedAt ||
      otp.consumedAt ||
      otp.invalidatedAt ||
      !otp.activeContextKey ||
      (otp.activeContextKey === replacementKey &&
        (!acceptReplacementAuthority || otp.expiresAt.getTime() <= now.getTime()))
    ) {
      throw new ConflictException(
        'Mobile verification is not valid for duplicate booking resolution.',
      );
    }
    return otp;
  }

  private assertDraftUsable(draft: LockedDraft, now: Date) {
    if (
      draft.status !== 'PENDING_OTP' ||
      draft.consumedAt ||
      draft.cancelledAt ||
      !draft.activeDraftKey ||
      draft.expiresAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException('Booking draft is no longer active.');
    }
  }

  private requireMobileHash(draft: LockedDraft): string {
    if (!draft.mobileNumberHash) {
      throw new ConflictException('Booking mobile identity is incomplete.');
    }
    return draft.mobileNumberHash;
  }

  private replacementContextKey(bookingDraftId: string): string {
    return `REPLACEMENT:${bookingDraftId}`;
  }
}
