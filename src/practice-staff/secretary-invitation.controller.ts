import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';
import { SecretaryInvitationService } from './secretary-invitation.service';

@UseGuards(SessionAuthGuard, CsrfOriginGuard)
@Controller('practice-staff/invitations')
export class SecretaryInvitationController {
  constructor(private readonly invitations: SecretaryInvitationService) {}
  @Post() create(
    @Body() dto: CreateSecretaryInvitationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.invitations.create(request.user.userId, dto);
  }
}
