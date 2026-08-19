import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { NotificationModule } from '../notification/notification.module';
import { OtpModule } from '../otp/otp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { BookingGroupRecoveryController } from './booking-group-recovery.controller';
import { BookingGroupRecoveryService } from './booking-group-recovery.service';
import { ContactPreferenceWithdrawalService } from './contact-preference-withdrawal.service';
import { PatientAppointmentDashboardService } from './patient-appointment-dashboard.service';
import { PatientBookingAccessController } from './patient-booking-access.controller';
import { PatientBookingAccessService } from './patient-booking-access.service';
import { PatientBookingGroupAccessController } from './patient-booking-group-access.controller';
import { PatientBookingGroupAccessService } from './patient-booking-group-access.service';

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
    BookingGroupRecoveryController,
  ],
  providers: [
    PatientAppointmentDashboardService,
    PatientBookingAccessService,
    PatientBookingGroupAccessService,
    BookingGroupRecoveryService,
    ContactPreferenceWithdrawalService,
  ],
  exports: [
    PatientAppointmentDashboardService,
    PatientBookingAccessService,
    PatientBookingGroupAccessService,
    BookingGroupRecoveryService,
    ContactPreferenceWithdrawalService,
  ],
})
export class PatientAccessModule {}
