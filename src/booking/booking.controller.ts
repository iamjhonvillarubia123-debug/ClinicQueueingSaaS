import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingService } from './booking.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly bookingConfigurationService: BookingConfigurationService,
  ) {}

  @Get('configuration/:practiceLocationId')
  getConfiguration(@Param('practiceLocationId') practiceLocationId: string) {
    return this.bookingConfigurationService.getEffectiveConfiguration(
      practiceLocationId,
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
