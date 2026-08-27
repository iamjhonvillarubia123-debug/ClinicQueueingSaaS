import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { OtpModule } from '../otp/otp.module';
import { PatientAccessModule } from '../patient-access/patient-access.module';
import { PublicRoutingModule } from '../public-routing/public-routing.module';
import { QueueModule } from '../queue/queue.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingAccessTokenIssuerService } from './booking-access-token-issuer.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';
import { BookingConfirmationService } from './booking-confirmation.service';
import { BookingController } from './booking.controller';
import { BookingDraftCleanupService } from './booking-draft-cleanup.service';
import { BookingDraftControlService } from './booking-draft-control.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingGroupAccessTokenIssuerService } from './booking-group-access-token-issuer.service';
import { BookingGroupAddPersonController } from './booking-group-add-person.controller';
import { BookingGroupAddPersonService } from './booking-group-add-person.service';
import { BookingGroupMemberCancellationController } from './booking-group-member-cancellation.controller';
import { BookingGroupMemberCancellationService } from './booking-group-member-cancellation.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';
import { MultiPersonBookingConfirmationService } from './multi-person-booking-confirmation.service';
import { PublicBookingDuplicateUseExistingController } from './public-booking-duplicate-use-existing.controller';
import { PublicBookingDuplicateUseExistingService } from './public-booking-duplicate-use-existing.service';
import { PublicBookingEntryService } from './public-booking-entry.service';
import { PublicBookingReplacementService } from './public-booking-replacement.service';

@Module({
  imports: [
    MobileNumberModule,
    OtpModule,
    ScheduleModule,
    IdempotencyModule,
    NotificationModule,
    PatientAccessModule,
    PublicRoutingModule,
    QueueModule,
    FinancialModule,
  ],
  controllers: [
    BookingController,
    PublicBookingDuplicateUseExistingController,
    BookingGroupAddPersonController,
    BookingGroupMemberCancellationController,
  ],
  providers: [
    BookingService,
    BookingConfigurationService,
    PublicBookingEntryService,
    BookingAnswerValidationService,
    BookingDraftCleanupService,
    BookingDraftControlService,
    BookingDraftEditService,
    BookingReferenceGenerator,
    ActiveBookingIdentityService,
    BookingConfirmationAdmissionService,
    BookingAccessTokenIssuerService,
    BookingGroupAccessTokenIssuerService,
    BookingGroupAddPersonService,
    BookingGroupMemberCancellationService,
    IndividualBookingConfirmationService,
    MultiPersonBookingConfirmationService,
    PublicBookingReplacementService,
    PublicBookingDuplicateUseExistingService,
    BookingConfirmationService,
  ],
  exports: [
    ActiveBookingIdentityService,
    BookingConfirmationAdmissionService,
    BookingAccessTokenIssuerService,
    BookingGroupAccessTokenIssuerService,
    BookingGroupAddPersonService,
    BookingGroupMemberCancellationService,
    IndividualBookingConfirmationService,
    MultiPersonBookingConfirmationService,
    PublicBookingReplacementService,
    PublicBookingDuplicateUseExistingService,
    BookingConfirmationService,
  ],
})
export class BookingModule {}
