import { Controller, Get, Request, UseGuards } from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Controller('secretary-workspace')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class SecretaryWorkspaceController {
  constructor(private readonly secretaryWorkspaceService: SecretaryWorkspaceService) {}

  @Get('clinics')
  listAssignedClinics(@Request() request: AuthenticatedRequest) {
    return this.secretaryWorkspaceService.listAssignedClinics(request.user.userId);
  }
}
