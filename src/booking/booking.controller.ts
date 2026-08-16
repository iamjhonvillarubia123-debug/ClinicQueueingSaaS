import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingService } from './booking.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly bookingConfigurationService: BookingConfigurationService,
    private readonly publicServiceDateAvailability: PublicServiceDateAvailabilityService,
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

  @Post('verify-otp')
  verifyOtp(@Body() verifyBookingOtpDto: VerifyBookingOtpDto) {
    return this.bookingService.verifyBookingOtp(verifyBookingOtpDto);
  }
}
