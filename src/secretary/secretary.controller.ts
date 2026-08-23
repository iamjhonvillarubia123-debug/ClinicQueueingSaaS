import {
  Body,
  Controller,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfirmCurrentPasswordDto } from '../auth/dto/confirm-current-password.dto';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { CurrentPasswordGuard } from '../auth/guards/current-password.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { PermanentlyDeleteSecretaryDto } from './dto/permanently-delete-secretary.dto';
import { ReactivateSecretaryDto } from './dto/reactivate-secretary.dto';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';

@Controller('secretary')
export class SecretaryController {
  constructor(
    private readonly secretaryLifecycleService: SecretaryLifecycleService,
  ) {}

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
