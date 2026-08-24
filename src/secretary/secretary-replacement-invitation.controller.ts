import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AcceptSecretaryInvitationDto } from './dto/accept-secretary-invitation.dto';
import { CreateSecretaryReplacementInvitationDto } from './dto/create-secretary-replacement-invitation.dto';
import { InspectSecretaryInvitationDto } from './dto/inspect-secretary-invitation.dto';
import { SecretaryReplacementInvitationService } from './secretary-replacement-invitation.service';

@Controller('secretary/replacement-invitations')
export class SecretaryReplacementInvitationController {
  constructor(private readonly service: SecretaryReplacementInvitationService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post()
  create(
    @Body() dto: CreateSecretaryReplacementInvitationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.service.create(request.user.userId, dto);
  }

  @Post('inspect')
  inspect(@Body() dto: InspectSecretaryInvitationDto) {
    return this.service.inspect(dto);
  }

  @Post('accept')
  accept(@Body() dto: AcceptSecretaryInvitationDto) {
    return this.service.accept(dto);
  }

  @UseGuards(SessionAuthGuard)
  @Get('location/:practiceLocationId')
  listForLocation(
    @Param('practiceLocationId') practiceLocationId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.service.listForLocation(request.user.userId, practiceLocationId);
  }
}
