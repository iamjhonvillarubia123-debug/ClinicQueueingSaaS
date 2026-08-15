import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationService } from './authentication.service';
import { EmailVerificationService } from './email-verification.service';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { ProtectedAccountPayloadService } from './security/protected-account-payload.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    ProtectedAccountPayloadService,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
  exports: [
    AuthService,
    AuthenticationService,
    EmailVerificationService,
    ProtectedAccountPayloadService,
    SessionAuthGuard,
    CsrfOriginGuard,
  ],
})
export class AuthModule {}
