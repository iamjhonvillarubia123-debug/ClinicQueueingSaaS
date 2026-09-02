import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Controller('secretary/workspace')
export class SecretaryWorkspaceController {
  constructor(private readonly workspace: SecretaryWorkspaceService) {}

  @UseGuards(SessionAuthGuard)
  @Get()
  getWorkspace(@Request() request: AuthenticatedRequest) {
    return this.workspace.getWorkspace(request.user.userId);
  }
}
