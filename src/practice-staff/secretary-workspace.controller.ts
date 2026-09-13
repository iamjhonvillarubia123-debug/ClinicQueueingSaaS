import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { SecretaryInvitationService } from './secretary-invitation.service';
import { DisconnectSecretaryClinicDto } from './dto/disconnect-secretary-clinic.dto';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import {
  Body,
  Param,
  Post,
  Controller,
  Get,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Controller('secretary/workspace')
export class SecretaryWorkspaceController {
  constructor(
    private readonly workspace: SecretaryWorkspaceService,
    private readonly invitations: SecretaryInvitationService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @RateLimit({
    id: 'secretary-clinic-disconnect',
    limit: 5,
    windowMs: 60000,
    subject: { kind: 'PARAM', field: 'practiceStaffId' },
  })
  @Post('clinics/:practiceStaffId/disconnect')
  disconnect(
    @Request() request: AuthenticatedRequest,
    @Param('practiceStaffId') practiceStaffId: string,
    @Body() dto: DisconnectSecretaryClinicDto,
  ) {
    return this.invitations.disconnectSelf(
      request.user.userId,
      practiceStaffId,
      dto.password,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get()
  getWorkspace(@Request() request: AuthenticatedRequest) {
    return this.workspace.getWorkspace(request.user.userId);
  }
}
