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
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { SESSION_COOKIE_NAME } from './security/session-security';
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
      maxAge: 12 * 60 * 60 * 1000,
    });

    return result.response;
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
