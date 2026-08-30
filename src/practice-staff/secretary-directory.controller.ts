import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SecretaryDirectoryService } from './secretary-directory.service';

@UseGuards(SessionAuthGuard)
@Controller('practice-staff/directory')
export class SecretaryDirectoryController {
  constructor(private readonly directory: SecretaryDirectoryService) {}
  @Get() get(@Request() request: AuthenticatedRequest) {
    return this.directory.getDoctorDirectory(request.user.userId);
  }
}
