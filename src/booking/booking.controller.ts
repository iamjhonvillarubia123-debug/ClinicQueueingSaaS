import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PATIENT_BOOKING_ACCESS_COOKIE } from '../patient-access/patient-booking-access.service';
import { PATIENT_BOOKING_GROUP_ACCESS_COOKIE } from '../patient-access/patient-booking-group-access.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingService } from './booking.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';
import { CreatePublicBookingDraftDto } from './dto/create-public-booking-draft.dto';
import {
  BookingDraftControlDto,
  ReplaceBookingDraftDto,
} from './dto/replace-booking-draft.dto';
import { ReplacePublicBookingDraftDto } from './dto/replace-public-booking-draft.dto';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto';
import { PublicBookingEntryService } from './public-booking-entry.service';

type PublicBookingGroupAppointment = {
  bookingReference: string;
  queueNumber: number;
  status: string;
  firstName: string | null;
  lastName: string | null;
};

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly bookingConfigurationService: BookingConfigurationService,
    private readonly publicServiceDateAvailability: PublicServiceDateAvailabilityService,
    private readonly bookingDraftEditService: BookingDraftEditService,
    private readonly bookingConfirmationService: BookingConfirmationService,
    private readonly publicBookingEntryService: PublicBookingEntryService,
  ) {}

  @RateLimit({
    id: 'booking-public-configuration',
    limit: 120,
    windowMs: 60 * 1000,
    subject: { kind: 'PARAM', field: 'publicIdentifier' },
  })
  @Get('public/configuration/:publicIdentifier')
  getPublicConfiguration(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicBookingEntryService.getConfiguration(publicIdentifier);
  }

  @RateLimit({
    id: 'booking-public-availability',
    limit: 60,
    windowMs: 60 * 1000,
    subject: { kind: 'PARAM', field: 'publicIdentifier' },
  })
  @Get('public/availability/:publicIdentifier/:serviceDate')
  getPublicAvailability(
    @Param('publicIdentifier') publicIdentifier: string,
    @Param('serviceDate') serviceDate: string,
  ) {
    return this.publicBookingEntryService.getAvailability(
      publicIdentifier,
      serviceDate,
    );
  }

  @RateLimit({
    id: 'booking-public-draft-create',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('public/draft/:publicIdentifier')
  createPublicDraft(
    @Param('publicIdentifier') publicIdentifier: string,
    @Body() dto: CreatePublicBookingDraftDto,
  ) {
    return this.publicBookingEntryService.createDraft(publicIdentifier, dto);
  }

  @Put('public/draft/:publicIdentifier/:bookingDraftId')
  replacePublicDraft(
    @Param('publicIdentifier') publicIdentifier: string,
    @Param('bookingDraftId') bookingDraftId: string,
    @Body() dto: ReplacePublicBookingDraftDto,
  ) {
    return this.publicBookingEntryService.replaceDraft(
      publicIdentifier,
      bookingDraftId,
      dto,
    );
  }

  @RateLimit({
    id: 'booking-configuration',
    limit: 120,
    windowMs: 60 * 1000,
    subject: { kind: 'PARAM', field: 'practiceLocationId' },
  })
  @Get('configuration/:practiceLocationId')
  getConfiguration(@Param('practiceLocationId') practiceLocationId: string) {
    return this.bookingConfigurationService.getEffectiveConfiguration(
      practiceLocationId,
    );
  }

  @RateLimit({
    id: 'booking-availability',
    limit: 60,
    windowMs: 60 * 1000,
    subject: { kind: 'PARAM', field: 'practiceLocationId' },
  })
  @Get('availability/:practiceLocationId/:serviceDate')
  getAvailability(
    @Param('practiceLocationId') practiceLocationId: string,
    @Param('serviceDate') serviceDate: string,
  ) {
    return this.publicServiceDateAvailability.resolve(
      practiceLocationId,
      serviceDate,
    );
  }

  @RateLimit({
    id: 'booking-draft-create',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('draft')
  async createDraft(@Body() createBookingDraftDto: CreateBookingDraftDto) {
    const availability = await this.publicServiceDateAvailability.resolve(
      createBookingDraftDto.practiceLocationId,
      createBookingDraftDto.serviceDate,
    );
    if (!availability.availableForPublicBooking) {
      throw new BadRequestException(
        'Selected Service Date is not available for public booking.',
      );
    }
    return this.bookingService.createDraft(createBookingDraftDto);
  }

  @Put('draft/:bookingDraftId')
  replaceDraft(
    @Param('bookingDraftId') bookingDraftId: string,
    @Body() replaceBookingDraftDto: ReplaceBookingDraftDto,
  ) {
    return this.bookingDraftEditService.replaceDraft(
      bookingDraftId,
      replaceBookingDraftDto,
    );
  }

  @Post('draft/:bookingDraftId/request-otp')
  requestBookingOtp(
    @Param('bookingDraftId') bookingDraftId: string,
    @Body() bookingDraftControlDto: BookingDraftControlDto,
  ) {
    return this.bookingDraftEditService.requestBookingOtp(
      bookingDraftId,
      bookingDraftControlDto,
    );
  }

  @Post('verify-otp')
  verifyOtp(@Body() verifyBookingOtpDto: VerifyBookingOtpDto) {
    return this.bookingService.verifyBookingOtp(verifyBookingOtpDto);
  }

  @Post('draft/:bookingDraftId/confirm')
  async confirmBooking(
    @Param('bookingDraftId') bookingDraftId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const result = await this.bookingConfirmationService.confirm({
      bookingDraftId,
      idempotencyKey,
    });

    if ('bookingAccessToken' in result && result.bookingAccessToken) {
      response?.cookie(
        PATIENT_BOOKING_ACCESS_COOKIE,
        result.bookingAccessToken.token,
        {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: `/patient-bookings/${encodeURIComponent(
            result.appointment.bookingReference,
          )}`,
          expires: result.bookingAccessToken.expiresAt,
        },
      );
      return {
        appointment: result.appointment,
        bookingAccessToken: {
          expiresAt: result.bookingAccessToken.expiresAt,
          transport: 'HTTP_ONLY_COOKIE',
        },
        replayed: result.replayed,
      };
    }

    if ('bookingGroup' in result) {
      if (result.bookingGroupAccessToken) {
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
      }

      const appointments = result.bookingGroup
        .appointments as PublicBookingGroupAppointment[];

      return {
        bookingGroup: {
          serviceDate: result.bookingGroup.serviceDate,
          appointments: appointments.map((appointment) => ({
            bookingReference: appointment.bookingReference,
            queueNumber: appointment.queueNumber,
            status: appointment.status,
            firstName: appointment.firstName,
            lastName: appointment.lastName,
          })),
        },
        bookingGroupAccessToken: result.bookingGroupAccessToken
          ? {
              expiresAt: result.bookingGroupAccessToken.expiresAt,
              transport: 'HTTP_ONLY_COOKIE',
            }
          : null,
        replayed: result.replayed,
      };
    }

    return result;
  }
}
