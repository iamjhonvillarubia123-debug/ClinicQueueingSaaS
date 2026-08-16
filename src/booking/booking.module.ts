import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { OtpModule } from '../otp/otp.module';
import { QueueModule } from '../queue/queue.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingAccessTokenIssuerService } from './booking-access-token-issuer.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingController } from './booking.controller';
import { BookingDraftCleanupService } from './booking-draft-cleanup.service';
import { BookingDraftControlService } from './booking-draft-control.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';

@Module({
  imports: [
    MobileNumberModule,
    OtpModule,
    ScheduleModule,
    IdempotencyModule,
    NotificationModule,
    QueueModule,
  ],
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
    BookingAccessTokenIssuerService,
    IndividualBookingConfirmationService,
  ],
  exports: [
    ActiveBookingIdentityService,
    BookingConfirmationAdmissionService,
    BookingAccessTokenIssuerService,
    IndividualBookingConfirmationService,
  ],
})
export class BookingModule {}
