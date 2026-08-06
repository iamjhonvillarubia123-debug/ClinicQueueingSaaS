import { Module } from '@nestjs/common';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { OtpModule } from '../otp/otp.module';

@Module({
  imports: [
  MobileNumberModule,
  OtpModule,
],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingReferenceGenerator,
  ],
})
export class BookingModule {}

