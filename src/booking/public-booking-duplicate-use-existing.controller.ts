import { Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PATIENT_BOOKING_ACCESS_COOKIE } from '../patient-access/patient-booking-access.service';
import { PATIENT_BOOKING_GROUP_ACCESS_COOKIE } from '../patient-access/patient-booking-group-access.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PublicBookingDuplicateUseExistingService } from './public-booking-duplicate-use-existing.service';

@Controller('booking')
export class PublicBookingDuplicateUseExistingController {
  constructor(
    private readonly useExistingService: PublicBookingDuplicateUseExistingService,
  ) {}

  @RateLimit({
    id: 'booking-verified-use-existing',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'PARAM', field: 'bookingDraftId' },
  })
  @Post('draft/:bookingDraftId/use-existing')
  async useExisting(
    @Param('bookingDraftId') bookingDraftId: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const result = await this.useExistingService.useExisting(bookingDraftId);

    if (result.contextKind === 'INDIVIDUAL') {
      response?.cookie(
        PATIENT_BOOKING_ACCESS_COOKIE,
        result.bookingAccessToken.token,
        {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: `/patient-bookings/${encodeURIComponent(result.bookingReference)}`,
          expires: result.bookingAccessToken.expiresAt,
        },
      );
      return {
        contextKind: result.contextKind,
        bookingReference: result.bookingReference,
        bookingAccessToken: {
          expiresAt: result.bookingAccessToken.expiresAt,
          transport: 'HTTP_ONLY_COOKIE',
        },
      };
    }

    response?.cookie(
      PATIENT_BOOKING_GROUP_ACCESS_COOKIE,
      result.bookingGroupAccessToken.token,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/patient-booking-groups',
        expires: result.bookingGroupAccessToken.expiresAt,
      },
    );
    return {
      contextKind: result.contextKind,
      bookingGroupId: result.bookingGroupId,
      bookingGroupAccessToken: {
        expiresAt: result.bookingGroupAccessToken.expiresAt,
        transport: 'HTTP_ONLY_COOKIE',
      },
    };
  }
}
