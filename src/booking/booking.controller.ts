import { Body, Controller, Post } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';

@Controller('booking')
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
  ) {}

  @Post('draft')
  createDraft(
    @Body() createBookingDraftDto: CreateBookingDraftDto,
  ) {
    return this.bookingService.createDraft(createBookingDraftDto);
  }
}