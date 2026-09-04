import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingAccessTokenIssuerService } from './booking-access-token-issuer.service';
import { BookingGroupAccessTokenIssuerService } from './booking-group-access-token-issuer.service';

const ACTIVE_STATUSES = [
  'WAITING',
  'CALLED',
  'TEMPORARILY_ABSENT',
  'OUT_FOR_PROCEDURE',
] as const;

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
};

@Injectable()
export class PublicBookingDuplicateUseExistingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activeBookingIdentity: ActiveBookingIdentityService,
    private readonly bookingAccessTokens: BookingAccessTokenIssuerService,
    private readonly bookingGroupAccessTokens: BookingGroupAccessTokenIssuerService,
  ) {}

  async useExisting(bookingDraftId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const draft = await this.lockDraft(transaction, bookingDraftId);
      this.assertDraftUsable(draft, now);
      const otp = await this.lockVerifiedBookingOtp(transaction, draft.id);
      const mobileNumberHash = this.requireMobileHash(draft);
      const activeAppointmentKey =
        this.activeBookingIdentity.deriveAppointmentKey(
          mobileNumberHash,
          draft.practiceLocationId,
          draft.serviceDate,
        );

      await this.activeBookingIdentity.acquireAppointmentScopeLock(
        transaction,
        activeAppointmentKey,
      );

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
          serviceDate: true,
        },
      });

      const groups = await transaction.bookingGroup.findMany({
        where: {
          controllingMobileNumberHash: mobileNumberHash,
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
        },
        take: 2,
      });

      const contextCount = (individual ? 1 : 0) + groups.length;
      if (contextCount !== 1) {
        throw new ConflictException(
          contextCount > 1
            ? 'Public booking uniqueness is inconsistent for this verified mobile scope.'
            : 'There is no active public booking to restore for this verified mobile scope.',
        );
      }

      let result:
        | {
            contextKind: 'INDIVIDUAL';
            bookingReference: string;
            bookingAccessToken: { token: string; expiresAt: Date };
          }
        | {
            contextKind: 'BOOKING_GROUP';
            bookingGroupId: string;
            bookingGroupAccessToken: { token: string; expiresAt: Date };
          };

      if (individual) {
        await transaction.bookingAccessToken.updateMany({
          where: {
            appointmentId: individual.id,
            tokenHash: { not: null },
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });
        const issued = await this.bookingAccessTokens.issueInitialToken(
          transaction,
          individual.id,
          individual.serviceDate,
        );
        result = {
          contextKind: 'INDIVIDUAL',
          bookingReference: individual.bookingReference,
          bookingAccessToken: {
            token: issued.rawToken,
            expiresAt: issued.expiresAt,
          },
        };
      } else {
        const group = groups[0];
        if (!group) {
          throw new ConflictException(
            'There is no active public booking to restore for this verified mobile scope.',
          );
        }
        await transaction.bookingGroupAccessToken.updateMany({
          where: {
            bookingGroupId: group.id,
            tokenHash: { not: null },
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });
        const issued = await this.bookingGroupAccessTokens.issueInitialToken(
          transaction,
          group.id,
          group.serviceDate,
        );
        result = {
          contextKind: 'BOOKING_GROUP',
          bookingGroupId: group.id,
          bookingGroupAccessToken: {
            token: issued.rawToken,
            expiresAt: issued.expiresAt,
          },
        };
      }

      await transaction.otpVerification.update({
        where: { id: otp.id },
        data: {
          consumedAt: now,
          activeContextKey: null,
          otpHash: null,
          otpHashKeyVersion: null,
        },
      });
      await transaction.bookingDraft.update({
        where: { id: draft.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          activeDraftKey: null,
          draftControlTokenHash: null,
        },
      });

      return result;
    });
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
    if (!draft) throw new NotFoundException('Booking draft is not available.');
    return draft;
  }

  private async lockVerifiedBookingOtp(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
  ): Promise<LockedOtp> {
    const rows = await transaction.$queryRaw<LockedOtp[]>(Prisma.sql`
      SELECT "id", "verifiedAt", "consumedAt", "invalidatedAt", "activeContextKey"
      FROM "OtpVerification"
      WHERE "bookingDraftId" = ${bookingDraftId}
        AND "purpose" = 'BOOKING'
        AND "activeContextKey" = ${`BOOKING:${bookingDraftId}`}
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
      throw new ConflictException(
        'Mobile verification is not valid for duplicate booking resolution.',
      );
    }
    return otp;
  }

  private assertDraftUsable(draft: LockedDraft, now: Date): void {
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
}
