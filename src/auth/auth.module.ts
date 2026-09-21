import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { OtpGenerator } from '../otp/otp.generator';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { AccountMobileVerificationService } from './account-mobile-verification.service';
import { AccountRegistrationService } from './account-registration.service';
import { AccountSecurityController } from './account-security.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationService } from './authentication.service';
import { EmailVerificationService } from './email-verification.service';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { PasswordResetMaintenanceService } from './password-reset-maintenance.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';
import { SessionManagementController } from './session-management.controller';
import { SessionManagementService } from './session-management.service';

@Module({
  imports: [PrismaModule, ConfigModule, MobileNumberModule],
  controllers: [
    AuthController,
    SessionManagementController,
    AccountSecurityController,
  ],
  providers: [
    SessionManagementService,
    AccountRegistrationService,
    AccountMobileVerificationService,
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    PasswordResetService,
    PasswordResetMaintenanceService,
    PasswordSecurityService,
    ProtectedAccountPayloadService,
    NotificationPayloadService,
    OtpGenerator,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
  exports: [
    SessionManagementService,
    AccountRegistrationService,
    AccountMobileVerificationService,
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    PasswordResetService,
    PasswordResetMaintenanceService,
    PasswordSecurityService,
    ProtectedAccountPayloadService,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
})
export class AuthModule {}
