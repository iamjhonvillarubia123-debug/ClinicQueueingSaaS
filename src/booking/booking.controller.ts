import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingService } from './booking.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';
import {
  BookingDraftControlDto,
  ReplaceBookingDraftDto,
} from './dto/replace-booking-draft.dto';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly bookingConfigurationService: BookingConfigurationService,
    private readonly publicServiceDateAvailability: PublicServiceDateAvailabilityService,
    private readonly bookingDraftEditService: BookingDraftEditService,
    private readonly individualBookingConfirmationService: IndividualBookingConfirmationService,
  ) {}

  @Get('configuration/:practiceLocationId')
  getConfiguration(@Param('practiceLocationId') practiceLocationId: string) {
    return this.bookingConfigurationService.getEffectiveConfiguration(
      practiceLocationId,
    );
  }

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

  @Post('draft')
  createDraft(@Body() createBookingDraftDto: CreateBookingDraftDto) {
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
  confirmIndividualBooking(
    @Param('bookingDraftId') bookingDraftId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.individualBookingConfirmationService.confirm({
      bookingDraftId,
      idempotencyKey,
    });
  }
}
