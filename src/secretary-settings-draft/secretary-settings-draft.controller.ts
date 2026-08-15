import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateSecretarySettingsDraftDto } from './dto/create-secretary-settings-draft.dto';
import { ReviewSecretarySettingsDraftDto } from './dto/review-secretary-settings-draft.dto';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Controller('secretary-settings-drafts')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class SecretarySettingsDraftController {
  constructor(
    private readonly secretarySettingsDraftService: SecretarySettingsDraftService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateSecretarySettingsDraftDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.create(request.user.userId, dto);
  }

  @Post(':draftId/submit')
  submit(
    @Param('draftId') draftId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.submit(
      request.user.userId,
      draftId,
    );
  }

  @Post(':draftId/reject')
  reject(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.reject(
      request.user.userId,
      draftId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':draftId/return-for-rework')
  returnForRework(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.returnForRework(
      request.user.userId,
      draftId,
      dto,
      idempotencyKey,
    );
  }
}
