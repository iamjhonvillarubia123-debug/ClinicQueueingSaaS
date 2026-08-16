import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingController } from './booking.controller';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';

@Module({
  imports: [MobileNumberModule, OtpModule],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingConfigurationService,
    BookingReferenceGenerator,
  ],
})
export class BookingModule {}
