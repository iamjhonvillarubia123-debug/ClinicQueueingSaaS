import { Module } from '@nestjs/common';
import { OtpModule } from '../otp/otp.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingController } from './booking.controller';
import { BookingDraftCleanupService } from './booking-draft-cleanup.service';
import { BookingDraftControlService } from './booking-draft-control.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';

@Module({
  imports: [MobileNumberModule, OtpModule, ScheduleModule],
  controllers: [BookingController],
  providers: [
    BookingService,
    BookingConfigurationService,
    BookingAnswerValidationService,
    BookingDraftCleanupService,
    BookingDraftControlService,
    BookingDraftEditService,
    BookingReferenceGenerator,
    ActiveBookingIdentityService,
    BookingConfirmationAdmissionService,
  ],
  exports: [ActiveBookingIdentityService, BookingConfirmationAdmissionService],
})
export class BookingModule {}
