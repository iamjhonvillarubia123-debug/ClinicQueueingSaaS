import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingController } from './booking.controller';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';

@Module({
  imports: [MobileNumberModule, OtpModule, ScheduleModule],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingConfigurationService,
    BookingAnswerValidationService,
    BookingReferenceGenerator,
  ],
})
export class BookingModule {}
