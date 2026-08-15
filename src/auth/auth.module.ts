import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationService } from './authentication.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { PasswordSecurityService } from './security/password-security.service';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    PasswordResetService,
    PasswordSecurityService,
    ProtectedAccountPayloadService,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
  exports: [
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    PasswordResetService,
    PasswordSecurityService,
    ProtectedAccountPayloadService,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
})
export class AuthModule {}
