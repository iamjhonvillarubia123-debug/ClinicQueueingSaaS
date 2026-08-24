import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfirmCurrentPasswordDto } from '../auth/dto/confirm-current-password.dto';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { CurrentPasswordGuard } from '../auth/guards/current-password.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AcceptSecretaryInvitationDto } from './dto/accept-secretary-invitation.dto';
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';
import { InspectSecretaryInvitationDto } from './dto/inspect-secretary-invitation.dto';
import { PermanentlyDeleteSecretaryDto } from './dto/permanently-delete-secretary.dto';
import { ReactivateSecretaryDto } from './dto/reactivate-secretary.dto';
import { SecretaryInvitationService } from './secretary-invitation.service';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';

@Controller('secretary')
export class SecretaryController {
  constructor(
    private readonly secretaryLifecycleService: SecretaryLifecycleService,
    private readonly secretaryInvitationService: SecretaryInvitationService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('invitations')
  createInvitation(
    @Request() request: AuthenticatedRequest,
    @Body() dto: CreateSecretaryInvitationDto,
  ) {
    return this.secretaryInvitationService.create(request.user.userId, dto);
  }

  @RateLimit({
    id: 'secretary-invitation-inspect',
    limit: 30,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('invitations/inspect')
  inspectInvitation(@Body() dto: InspectSecretaryInvitationDto) {
    return this.secretaryInvitationService.inspect(dto);
  }

  @RateLimit({
    id: 'secretary-invitation-accept',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('invitations/accept')
  acceptInvitation(@Body() dto: AcceptSecretaryInvitationDto) {
    return this.secretaryInvitationService.accept(dto);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('invitations/:invitationId/revoke')
  revokeInvitation(
    @Request() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    return this.secretaryInvitationService.revoke(
      request.user.userId,
      invitationId,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard, CurrentPasswordGuard)
  @Post('account/disable')
  disableAccount(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ConfirmCurrentPasswordDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    void dto;
    return this.secretaryLifecycleService.disable(
      request.user.userId,
      idempotencyKey,
    );
  }

  @Post('account/reactivate')
  reactivateAccount(
    @Body() dto: ReactivateSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.secretaryLifecycleService.reactivate(
      dto.email,
      dto.password,
      idempotencyKey,
    );
  }

  @Post('account/permanent-delete')
  permanentlyDeleteAccount(
    @Body() dto: PermanentlyDeleteSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.secretaryLifecycleService.permanentlyDelete(
      dto.email,
      dto.password,
      dto.confirmPermanentDelete,
      idempotencyKey,
    );
  }
}
