import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { CsrfOriginGuard } from './guards/csrf-origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { SessionManagementService } from './session-management.service';
import type { AuthenticatedRequest } from './types/authenticated-request';

export class RevokeOtherSessionsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  currentPassword!: string;
}

@Controller('auth/sessions')
@UseGuards(SessionAuthGuard)
export class SessionManagementController {
  constructor(private readonly sessions: SessionManagementService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RateLimit({
    id: 'session-list',
    limit: 60,
    windowMs: 60 * 1000,
    subject: { kind: 'NONE' },
  })
  list(@Request() request: AuthenticatedRequest) {
    return this.sessions.list(request.user);
  }

  @Post('revoke-others')
  @UseGuards(CsrfOriginGuard)
  @RateLimit({
    id: 'session-revoke-others',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  revokeOthers(
    @Request() request: AuthenticatedRequest,
    @Body() dto: RevokeOtherSessionsDto,
  ) {
    return this.sessions.revokeOthers(request.user, dto.currentPassword);
  }

  @Post(':sessionId/revoke')
  @UseGuards(CsrfOriginGuard)
  @RateLimit({
    id: 'session-revoke-one',
    limit: 30,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  revokeOne(
    @Request() request: AuthenticatedRequest,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.sessions.revokeOne(request.user, sessionId);
  }
}
