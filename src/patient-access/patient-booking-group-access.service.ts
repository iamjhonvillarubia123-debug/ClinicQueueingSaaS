import { createHash } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AppointmentStatus,
  BookingGroupAccessTokenPurpose,
  Prisma,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Prisma.TransactionClient;

export const PATIENT_BOOKING_GROUP_ACCESS_COOKIE = 'cq_booking_group_access';

export type PatientBookingGroupAccess = {
  tokenRecordId: string;
  expiresAt: Date;
  bookingGroup: {
    id: string;
    practiceLocationId: string;
    serviceDate: Date;
    servingProtectionEndedAt: Date | null;
    members: Array<{
      bookingReference: string;
      queueNumber: number;
      status: AppointmentStatus;
      servingOrderKey: Prisma.Decimal | null;
      waitingPlacementType: WaitingPlacementType | null;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      suffix: string | null;
    }>;
  };
};

@Injectable()
export class PatientBookingGroupAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async establish(
    rawToken: string,
    expectedBookingGroupId?: string,
  ): Promise<PatientBookingGroupAccess> {
    return this.prisma.$transaction(async (transaction) => {
      return this.validateToken(
        transaction,
        rawToken,
        expectedBookingGroupId,
      );
    });
  }

  async validateControllerToken(
    transaction: TransactionClient,
    rawToken: string,
    expectedBookingGroupId?: string,
  ): Promise<PatientBookingGroupAccess> {
    return this.validateToken(transaction, rawToken, expectedBookingGroupId);
  }

  readCookie(cookieHeader: string | undefined): string {
    if (!cookieHeader) this.fail();
    const prefix = `${PATIENT_BOOKING_GROUP_ACCESS_COOKIE}=`;
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

  cookiePath(bookingGroupId: string): string {
    return `/patient-booking-groups/${encodeURIComponent(bookingGroupId)}`;
  }

  private async validateToken(
    transaction: TransactionClient,
    rawToken: string,
    expectedBookingGroupId?: string,
  ): Promise<PatientBookingGroupAccess> {
    this.assertRawTokenShape(rawToken);
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const now = new Date();

    const token = await transaction.bookingGroupAccessToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        purpose: true,
        expiresAt: true,
        revokedAt: true,
        tokenHash: true,
        bookingGroup: {
          select: {
            id: true,
            practiceLocationId: true,
            serviceDate: true,
            servingProtectionEndedAt: true,
            appointments: {
              where: { anonymizedAt: null },
              orderBy: { queueNumber: 'asc' },
              select: {
                bookingReference: true,
                queueNumber: true,
                status: true,
                servingOrderKey: true,
                waitingPlacementType: true,
                firstName: true,
                middleName: true,
                lastName: true,
                suffix: true,
              },
            },
          },
        },
      },
    });

    if (
      !token ||
      !token.tokenHash ||
      token.revokedAt ||
      token.expiresAt.getTime() <= now.getTime() ||
      token.purpose !== BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS ||
      token.bookingGroup.appointments.length === 0 ||
      (expectedBookingGroupId !== undefined &&
        token.bookingGroup.id !== expectedBookingGroupId)
    ) {
      return this.fail();
    }

    await transaction.bookingGroupAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: now },
    });

    return {
      tokenRecordId: token.id,
      expiresAt: token.expiresAt,
      bookingGroup: {
        id: token.bookingGroup.id,
        practiceLocationId: token.bookingGroup.practiceLocationId,
        serviceDate: token.bookingGroup.serviceDate,
        servingProtectionEndedAt: token.bookingGroup.servingProtectionEndedAt,
        members: token.bookingGroup.appointments,
      },
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
    throw new UnauthorizedException(
      'Patient booking group access is unavailable.',
    );
  }
}
