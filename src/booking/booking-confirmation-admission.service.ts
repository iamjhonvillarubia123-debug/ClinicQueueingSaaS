import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { ActiveBookingIdentityService } from './active-booking-identity.service';

type TransactionClient = Prisma.TransactionClient;

export type LockedConfirmationDraft = {
  id: string;
  mode: 'INDIVIDUAL' | 'MULTI_PERSON';
  status: 'PENDING_OTP' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberHash: string | null;
  activeDraftKey: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
  doctorProfileId: string;
  doctorUserId: string;
};

export type LockedVerifiedBookingOtp = {
  id: string;
  verifiedAt: Date;
};

type LockedDoctorAdmissionState = {
  accountStatus: 'ACTIVE' | 'VOLUNTARILY_DISABLED' | 'PERMANENTLY_CLOSED';
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
};

@Injectable()
export class BookingConfirmationAdmissionService {
  constructor(
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly activeBookingIdentity: ActiveBookingIdentityService,
  ) {}

  async lockAndValidateCurrentAdmission(
    transaction: TransactionClient,
    bookingDraftId: string,
    now = new Date(),
  ): Promise<{
    draft: LockedConfirmationDraft;
    otp: LockedVerifiedBookingOtp;
    activeAppointmentKey: string;
    maximumOperatingUntilAt: Date | null;
  }> {
    const draft = await this.lockDraft(transaction, bookingDraftId);
    this.assertDraftCanConfirm(draft, now);

    await this.acquireDoctorScheduleLock(transaction, draft.doctorProfileId);
    const doctorState = await this.lockDoctorAdmissionState(
      transaction,
      draft.doctorUserId,
    );
    const entitlementGraceEndsAt = await this.lockSubscriptionEntitlement(
      transaction,
      draft.doctorUserId,
    );
    const otp = await this.lockVerifiedOtp(transaction, draft.id);
    this.assertDoctorAndSubscriptionEligible(
      doctorState,
      entitlementGraceEndsAt,
      now,
    );

    const serviceDate = draft.serviceDate.toISOString().slice(0, 10);
    const availability = await this.availability.resolve(
      draft.practiceLocationId,
      serviceDate,
      now,
      transaction,
    );
    if (!availability.availableForPublicBooking) {
      throw new ConflictException(
        'Booking confirmation is no longer available for this Service Date.',
      );
    }

    if (!draft.mobileNumberHash) {
      throw new ConflictException(
        'Booking confirmation identity is incomplete.',
      );
    }

    const activeAppointmentKey =
      this.activeBookingIdentity.deriveAppointmentKey(
        draft.mobileNumberHash,
        draft.practiceLocationId,
        draft.serviceDate,
      );
    await this.activeBookingIdentity.acquireAppointmentScopeLock(
      transaction,
      activeAppointmentKey,
    );
    await this.activeBookingIdentity.assertNoActivePublicBookingContext(
      transaction,
      activeAppointmentKey,
      draft.mobileNumberHash,
      draft.practiceLocationId,
      draft.serviceDate,
    );

    return {
      draft,
      otp,
      activeAppointmentKey,
      maximumOperatingUntilAt: availability.maximumOperatingUntilAt,
    };
  }

  async acquireCapacityScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const dateKey = serviceDate.toISOString().slice(0, 10);
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`BOOKING_CAPACITY:${practiceLocationId}:${dateKey}`}, 0)
      )
    `);
  }

  async assertCapacityAvailable(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
    maximumOperatingUntilAt: Date | null,
    requestedEstimatedMinutes: number,
  ): Promise<void> {
    if (
      !Number.isInteger(requestedEstimatedMinutes) ||
      requestedEstimatedMinutes < 1
    ) {
      throw new ConflictException(
        'Booking duration is invalid for confirmation.',
      );
    }
    if (!maximumOperatingUntilAt) {
      return;
    }

    const rows = await transaction.$queryRaw<
      Array<{ totalMinutes: number | bigint | null }>
    >(Prisma.sql`
      SELECT COALESCE(SUM("estimatedServiceMinutes"), 0)::bigint AS "totalMinutes"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" IN ('WAITING', 'CALLED', 'TEMPORARILY_ABSENT', 'OUT_FOR_PROCEDURE')
    `);
    const existingMinutes = Number(rows[0]?.totalMinutes ?? 0);

    const schedule = await this.availability.resolveCapacitySchedule(
      practiceLocationId,
      serviceDate.toISOString().slice(0, 10),
      transaction,
    );
    if (!schedule.opensAt || !schedule.maximumOperatingUntilAt) {
      throw new ConflictException(
        'Booking capacity cannot be established for this Service Date.',
      );
    }

    const projectedFinish = new Date(
      schedule.opensAt.getTime() +
        (existingMinutes + requestedEstimatedMinutes) * 60_000,
    );
    if (projectedFinish.getTime() > maximumOperatingUntilAt.getTime()) {
      throw new ConflictException(
        'Online booking is full for this Service Date.',
      );
    }
  }

  private async lockDraft(
    transaction: TransactionClient,
    bookingDraftId: string,
  ): Promise<LockedConfirmationDraft> {
    const rows = await transaction.$queryRaw<LockedConfirmationDraft[]>(
      Prisma.sql`
        SELECT
          bd."id",
          bd."mode",
          bd."status",
          bd."practiceLocationId",
          bd."serviceDate",
          bd."mobileNumberHash",
          bd."activeDraftKey",
          bd."expiresAt",
          bd."consumedAt",
          bd."cancelledAt",
          dp."id" AS "doctorProfileId",
          u."id" AS "doctorUserId"
        FROM "BookingDraft" bd
        INNER JOIN "PracticeLocation" pl ON pl."id" = bd."practiceLocationId"
        INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
        INNER JOIN "User" u ON u."id" = dp."userId"
        WHERE bd."id" = ${bookingDraftId}
        LIMIT 1
        FOR UPDATE OF bd, pl
      `,
    );
    const draft = rows[0];
    if (!draft) {
      throw new NotFoundException(
        'Booking draft is not available for confirmation.',
      );
    }
    return draft;
  }

  private async acquireDoctorScheduleLock(
    transaction: TransactionClient,
    doctorProfileId: string,
  ): Promise<void> {
    const scope = `DOCTOR_SCHEDULE|${doctorProfileId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
    `);
  }

  private async lockDoctorAdmissionState(
    transaction: TransactionClient,
    doctorUserId: string,
  ): Promise<LockedDoctorAdmissionState> {
    const rows = await transaction.$queryRaw<LockedDoctorAdmissionState[]>(
      Prisma.sql`
        SELECT "accountStatus", "administrativeRestrictionStatus"
        FROM "User"
        WHERE "id" = ${doctorUserId}
        FOR UPDATE
      `,
    );
    const doctor = rows[0];
    if (!doctor) {
      throw new ConflictException(
        'Booking confirmation is currently unavailable.',
      );
    }
    return doctor;
  }

  private async lockSubscriptionEntitlement(
    transaction: TransactionClient,
    doctorUserId: string,
  ): Promise<Date | null> {
    const rows = await transaction.$queryRaw<
      Array<{ graceEndsAt: Date | null }>
    >(Prisma.sql`
      SELECT dse."graceEndsAt"
      FROM "DoctorFinancialAccount" dfa
      INNER JOIN "DoctorSubscriptionEntitlement" dse
        ON dse."doctorFinancialAccountId" = dfa."id"
      WHERE dfa."doctorUserId" = ${doctorUserId}
      LIMIT 1
      FOR UPDATE OF dse
    `);
    return rows[0]?.graceEndsAt ?? null;
  }

  private async lockVerifiedOtp(
    transaction: TransactionClient,
    bookingDraftId: string,
  ): Promise<LockedVerifiedBookingOtp> {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        verifiedAt: Date | null;
        consumedAt: Date | null;
        invalidatedAt: Date | null;
        activeContextKey: string | null;
      }>
    >(Prisma.sql`
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
        'Booking OTP is not verified for confirmation.',
      );
    }
    return { id: otp.id, verifiedAt: otp.verifiedAt };
  }

  private assertDraftCanConfirm(
    draft: LockedConfirmationDraft,
    now: Date,
  ): void {
    if (
      draft.status !== 'PENDING_OTP' ||
      draft.consumedAt ||
      draft.cancelledAt ||
      draft.expiresAt.getTime() <= now.getTime() ||
      !draft.activeDraftKey
    ) {
      throw new ConflictException(
        'Booking draft is not eligible for confirmation.',
      );
    }
  }

  private assertDoctorAndSubscriptionEligible(
    doctor: LockedDoctorAdmissionState,
    entitlementGraceEndsAt: Date | null,
    now: Date,
  ): void {
    if (
      doctor.accountStatus !== 'ACTIVE' ||
      doctor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ConflictException(
        'Booking confirmation is currently unavailable.',
      );
    }
    if (
      !entitlementGraceEndsAt ||
      entitlementGraceEndsAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException(
        'Booking confirmation is currently unavailable.',
      );
    }
  }
}
