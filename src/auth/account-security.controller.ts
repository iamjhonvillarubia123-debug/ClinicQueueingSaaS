import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { SessionManagementService } from './session-management.service';
import type { AuthenticatedRequest } from './types/authenticated-request';

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(1024) currentPassword!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) newPassword!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) confirmNewPassword!: string;
}

@Controller('auth/account')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class AccountSecurityController {
  constructor(private readonly sessions: SessionManagementService) {}
  @Post('change-password')
  @RateLimit({
    id: 'account-change-password',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  changePassword(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.sessions.changePassword(
      request.user,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmNewPassword,
    );
  }
}
