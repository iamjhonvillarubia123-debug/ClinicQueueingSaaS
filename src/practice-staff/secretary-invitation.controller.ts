import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AcceptSecretaryInvitationDto } from './dto/accept-secretary-invitation.dto';
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';
import { SecretaryInvitationService } from './secretary-invitation.service';

@Controller('practice-staff/invitations')
export class SecretaryInvitationController {
  constructor(private readonly invitations: SecretaryInvitationService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post()
  create(
    @Body() dto: CreateSecretaryInvitationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.create(request.user.userId, dto);
  }

  @Get('preview')
  preview(@Query('token') token: string) {
    return this.invitations.preview(token);
  }

  @UseGuards(CsrfOriginGuard)
  @Post('accept')
  accept(@Body() dto: AcceptSecretaryInvitationDto) {
    return this.invitations.accept(dto.token, dto.password);
  }
}
