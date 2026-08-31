import {
  Body,
  Controller,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PermanentlyDeleteSecretaryDto } from './dto/permanently-delete-secretary.dto';
import { ReactivateSecretaryDto } from './dto/reactivate-secretary.dto';
import { RegisterSecretaryDto } from './dto/register-secretary.dto';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';
import { SecretaryRegistrationService } from './secretary-registration.service';

@Controller('secretary')
export class SecretaryController {
  constructor(
    private readonly secretaryLifecycleService: SecretaryLifecycleService,
    private readonly secretaryRegistrationService: SecretaryRegistrationService,
  ) {}

  @RateLimit({
    id: 'secretary-register',
    limit: 5,
    windowMs: 60 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('register')
  register(@Body() dto: RegisterSecretaryDto) {
    return this.secretaryRegistrationService.register(dto);
  }

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
