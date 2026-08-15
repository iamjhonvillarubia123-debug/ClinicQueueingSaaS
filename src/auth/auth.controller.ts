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
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { LoginDto } from './dto/login.dto';
import { ResendEmailVerificationDto } from './dto/resend-email-verification.dto';
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
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto);

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

  @Post('resend-email-verification')
  resendEmailVerification(@Body() dto: ResendEmailVerificationDto) {
    return this.emailVerificationService.resend(dto.email);
  }

  @Post('verify-email')
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.emailVerificationService.verify(verifyEmailDto.token);
  }

  @UseGuards(SessionAuthGuard)
  @Get('profile')
  getProfile(@Request() request: AuthenticatedRequest) {
    return {
      userId: request.user.userId,
      role: request.user.role,
    };
  }
}
