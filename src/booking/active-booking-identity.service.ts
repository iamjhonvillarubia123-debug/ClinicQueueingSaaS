import { createHash } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class ActiveBookingIdentityService {
  deriveDraftKey(
    mobileNumberHash: string,
    practiceLocationId: string,
    serviceDate: Date,
  ): string {
    return this.hash(
      `ACTIVE_BOOKING_DRAFT|${mobileNumberHash}|${practiceLocationId}|${this.dateKey(serviceDate)}`,
    );
  }

  deriveAppointmentKey(
    mobileNumberHash: string,
    practiceLocationId: string,
    serviceDate: Date,
  ): string {
    return this.hash(
      `ACTIVE_APPOINTMENT|${mobileNumberHash}|${practiceLocationId}|${this.dateKey(serviceDate)}`,
    );
  }

  async acquireDraftScopeLock(
    transaction: TransactionClient,
    activeDraftKey: string,
  ): Promise<void> {
    await this.acquireLock(transaction, `BOOKING_DRAFT:${activeDraftKey}`);
  }

  async acquireAppointmentScopeLock(
    transaction: TransactionClient,
    activeAppointmentKey: string,
  ): Promise<void> {
    await this.acquireLock(
      transaction,
      `APPOINTMENT:${activeAppointmentKey}`,
    );
  }

  async assertNoActiveDraft(
    transaction: TransactionClient,
    activeDraftKey: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "BookingDraft"
      WHERE "activeDraftKey" = ${activeDraftKey}
      LIMIT 1
    `);

    if (rows.length > 0) {
      throw new ConflictException(
        'An active booking attempt already exists for this booking scope.',
      );
    }
  }

  async assertNoActiveAppointment(
    transaction: TransactionClient,
    activeAppointmentKey: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Appointment"
      WHERE "activeAppointmentKey" = ${activeAppointmentKey}
      LIMIT 1
    `);

    if (rows.length > 0) {
      throw new ConflictException(
        'An active confirmed booking already exists for this booking scope.',
      );
    }
  }

  async attachDraftKey(
    transaction: TransactionClient,
    bookingDraftId: string,
    activeDraftKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "BookingDraft"
      SET "activeDraftKey" = ${activeDraftKey}
      WHERE "id" = ${bookingDraftId}
        AND "status" = 'PENDING_OTP'
    `);
  }

  private async acquireLock(
    transaction: TransactionClient,
    lockIdentity: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
    `);
  }

  private dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
