import { createHash } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AppointmentStatus,
  BookingAccessTokenPurpose,
  Prisma,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

export const PATIENT_BOOKING_ACCESS_COOKIE = 'cq_booking_access';

export type PatientBookingAccess = {
  tokenRecordId: string;
  expiresAt: Date;
  appointment: {
    id: string;
    bookingReference: string;
    practiceLocationId: string;
    serviceDate: Date;
    queueNumber: number;
    status: AppointmentStatus;
    bookingGroupId: string | null;
    servingOrderKey: Prisma.Decimal | null;
    waitingPlacementType: WaitingPlacementType | null;
    selfServiceReinsertedAt: Date | null;
    anonymizedAt: Date | null;
  };
};

@Injectable()
export class PatientBookingAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async establish(rawToken: string): Promise<PatientBookingAccess> {
    return this.prisma.$transaction(async (transaction) => {
      return this.validateToken(transaction, rawToken, undefined, false);
    });
  }

  async validateManagementToken(
    transaction: TransactionClient,
    rawToken: string,
    bookingReference: string,
  ): Promise<PatientBookingAccess> {
    return this.validateToken(transaction, rawToken, bookingReference, true);
  }

  readCookie(cookieHeader: string | undefined): string {
    if (!cookieHeader) this.fail();
    const prefix = `${PATIENT_BOOKING_ACCESS_COOKIE}=`;
    for (const part of cookieHeader.split(';')) {
      const value = part.trim();
      if (value.startsWith(prefix)) {
        const token = decodeURIComponent(value.slice(prefix.length));
        this.assertRawTokenShape(token);
        return token;
      }
    }
    return this.fail();
  }

  cookiePath(bookingReference: string): string {
    return `/patient-bookings/${encodeURIComponent(bookingReference)}`;
  }

  private async validateToken(
    transaction: TransactionClient,
    rawToken: string,
    expectedBookingReference: string | undefined,
    managementRequired: boolean,
  ): Promise<PatientBookingAccess> {
    this.assertRawTokenShape(rawToken);
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const now = new Date();
    const token = await transaction.bookingAccessToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        purpose: true,
        expiresAt: true,
        revokedAt: true,
        tokenHash: true,
        appointment: {
          select: {
            id: true,
            bookingReference: true,
            practiceLocationId: true,
            serviceDate: true,
            queueNumber: true,
            status: true,
            bookingGroupId: true,
            servingOrderKey: true,
            waitingPlacementType: true,
            selfServiceReinsertedAt: true,
            anonymizedAt: true,
          },
        },
      },
    });

    if (
      !token ||
      !token.tokenHash ||
      token.revokedAt ||
      token.expiresAt.getTime() <= now.getTime() ||
      token.appointment.anonymizedAt ||
      (expectedBookingReference !== undefined &&
        token.appointment.bookingReference !== expectedBookingReference) ||
      (managementRequired &&
        token.purpose !== BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING)
    ) {
      return this.fail();
    }

    await transaction.bookingAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: now },
    });

    return {
      tokenRecordId: token.id,
      expiresAt: token.expiresAt,
      appointment: token.appointment,
    };
  }

  private assertRawTokenShape(rawToken: string): void {
    if (
      rawToken.length < 32 ||
      rawToken.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(rawToken)
    ) {
      this.fail();
    }
  }

  private fail(): never {
    throw new UnauthorizedException('Patient booking access is unavailable.');
  }
}
