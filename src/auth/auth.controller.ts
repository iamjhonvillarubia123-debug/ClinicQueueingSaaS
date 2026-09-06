import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AccountMobileVerificationService } from './account-mobile-verification.service';
import { AccountRegistrationService } from './account-registration.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { ConsumePasswordResetDto } from './dto/consume-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterAccountDto } from './dto/register-account.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResendEmailVerificationDto } from './dto/resend-email-verification.dto';
import {
  ResendMobileAccountVerificationDto,
  VerifyMobileAccountDto,
} from './dto/verify-mobile-account.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import {
  readCookie,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
} from './security/session-security';
import type { AuthenticatedRequest } from './types/authenticated-request';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly accountRegistrationService: AccountRegistrationService,
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly mobileVerificationService: AccountMobileVerificationService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @RateLimit({
    id: 'auth-register',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'identifier' },
  })
  @Post('register')
  register(@Body() dto: RegisterAccountDto) {
    return this.accountRegistrationService.register(dto);
  }

  @RateLimit({
    id: 'auth-login',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'identifier' },
  })
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto);

    if (result.sessionToken === null) {
      if (result.response.verificationChannel === 'MOBILE') {
        await this.mobileVerificationService.resend(result.response.userId);
      } else {
        await this.emailVerificationService.resend(loginDto.identifier);
      }
      return result.response;
    }

    response.cookie(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });

    return result.response;
  }

  @UseGuards(CsrfOriginGuard)
  @Post('logout')
  async logout(
    @Request() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const result = await this.authService.logout(rawToken);

    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return result;
  }

  @RateLimit({
    id: 'auth-password-reset-request',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'identifier' },
  })
  @Post('request-password-reset')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.passwordResetService.request(dto.identifier);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ConsumePasswordResetDto) {
    return this.passwordResetService.consume(dto.token, dto.newPassword);
  }

  @RateLimit({
    id: 'auth-email-verification-resend',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'email' },
  })
  @Post('resend-email-verification')
  resendEmailVerification(@Body() dto: ResendEmailVerificationDto) {
    return this.emailVerificationService.resend(dto.email);
  }

  @Post('verify-email')
  async verifyEmail(
    @Body() verifyEmailDto: VerifyEmailDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.emailVerificationService.verify(
      verifyEmailDto.token,
    );
    this.setSessionCookie(response, result.sessionToken);
    return { verified: result.verified, role: result.role };
  }

  @RateLimit({
    id: 'auth-mobile-verification-resend',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'userId' },
  })
  @Post('resend-mobile-verification')
  resendMobileVerification(@Body() dto: ResendMobileAccountVerificationDto) {
    return this.mobileVerificationService.resend(dto.userId);
  }

  @RateLimit({
    id: 'auth-mobile-verification-submit',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'userId' },
  })
  @Post('verify-mobile')
  async verifyMobile(
    @Body() dto: VerifyMobileAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.mobileVerificationService.verify(
      dto.userId,
      dto.otp,
    );
    this.setSessionCookie(response, result.sessionToken);
    return { verified: result.verified, role: result.role };
  }

  @UseGuards(SessionAuthGuard)
  @Get('profile')
  getProfile(@Request() request: AuthenticatedRequest) {
    return {
      userId: request.user.userId,
      role: request.user.role,
    };
  }

  private setSessionCookie(response: Response, sessionToken: string): void {
    response.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    });
  }
}
