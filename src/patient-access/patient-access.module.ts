import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActiveBookingIdentityService } from '../booking/active-booking-identity.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { OtpModule } from '../otp/otp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { AppointmentRecoveryController } from './appointment-recovery.controller';
import { AppointmentRecoveryService } from './appointment-recovery.service';
import { BookingGroupRecoveryController } from './booking-group-recovery.controller';
import { BookingGroupRecoveryService } from './booking-group-recovery.service';
import { ContactPreferenceWithdrawalService } from './contact-preference-withdrawal.service';
import { PatientAppointmentDashboardService } from './patient-appointment-dashboard.service';
import { PatientBookingAccessController } from './patient-booking-access.controller';
import { PatientBookingAccessService } from './patient-booking-access.service';
import { PatientBookingGroupAccessController } from './patient-booking-group-access.controller';
import { PatientBookingGroupAccessService } from './patient-booking-group-access.service';
import { PublicBookingRecoveryController } from './public-booking-recovery.controller';
import { PublicBookingRecoveryService } from './public-booking-recovery.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    MobileNumberModule,
    OtpModule,
    IdempotencyModule,
    NotificationModule,
  ],
  controllers: [
    PatientBookingAccessController,
    PatientBookingGroupAccessController,
    AppointmentRecoveryController,
    BookingGroupRecoveryController,
    PublicBookingRecoveryController,
  ],
  providers: [
    PatientAppointmentDashboardService,
    PatientBookingAccessService,
    PatientBookingGroupAccessService,
    AppointmentRecoveryService,
    BookingGroupRecoveryService,
    ContactPreferenceWithdrawalService,
    ActiveBookingIdentityService,
    PublicBookingRecoveryService,
  ],
  exports: [
    PatientAppointmentDashboardService,
    PatientBookingAccessService,
    PatientBookingGroupAccessService,
    AppointmentRecoveryService,
    BookingGroupRecoveryService,
    ContactPreferenceWithdrawalService,
    PublicBookingRecoveryService,
  ],
})
export class PatientAccessModule {}
