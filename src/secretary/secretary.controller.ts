import { Controller, Headers, Post, Request, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';

@Controller('secretary')
export class SecretaryController {
  constructor(
    private readonly secretaryLifecycleService: SecretaryLifecycleService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('account/disable')
  disableAccount(
    @Request() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.secretaryLifecycleService.disable(
      request.user.userId,
      idempotencyKey,
    );
  }
}
