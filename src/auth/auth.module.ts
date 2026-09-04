import { Module } from '@nestjs/common';
import { AccountSecurityController } from './account-security.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { AccountRegistrationService } from './account-registration.service';
import { AuthController } from './auth.controller';
import { SessionManagementController } from './session-management.controller';
import { SessionManagementService } from './session-management.service';
import { AuthService } from './auth.service';
import { AuthenticationService } from './authentication.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetMaintenanceService } from './password-reset-maintenance.service';
import { PasswordResetService } from './password-reset.service';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

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
  exports: [
    SessionManagementService,
    AccountRegistrationService,
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
