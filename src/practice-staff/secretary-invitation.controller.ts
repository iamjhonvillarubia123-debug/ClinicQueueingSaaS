import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UpdateSecretaryInvitationDto } from './dto/update-secretary-invitation.dto';
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

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Patch(':invitationId')
  update(
    @Param('invitationId') invitationId: string,
    @Body() dto: UpdateSecretaryInvitationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.updatePending(
      request.user.userId,
      invitationId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Delete(':invitationId')
  revoke(
    @Param('invitationId') invitationId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.revokePending(request.user.userId, invitationId);
  }

  @Get('preview')
  preview(@Query('token') token: string) {
    return this.invitations.preview(token);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('accept')
  accept(
    @Body() dto: AcceptSecretaryInvitationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.accept(request.user.userId, dto.token);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post(':invitationId/accept')
  acceptFromWorkspace(
    @Param('invitationId') invitationId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.acceptPendingById(
      request.user.userId,
      invitationId,
    );
  }
}
