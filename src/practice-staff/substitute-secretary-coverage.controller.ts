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
import { CancelSubstituteSecretaryCoverageDto } from './dto/cancel-substitute-secretary-coverage.dto';
import { CreateSubstituteSecretaryCoverageDto } from './dto/create-substitute-secretary-coverage.dto';
import { ReplaceSubstituteSecretaryCoverageDto } from './dto/replace-substitute-secretary-coverage.dto';
import { SubstituteSecretaryCoverageService } from './substitute-secretary-coverage.service';

@UseGuards(SessionAuthGuard, CsrfOriginGuard)
@Controller('practice-staff/substitute-coverage')
export class SubstituteSecretaryCoverageController {
  constructor(
    private readonly substituteSecretaryCoverageService: SubstituteSecretaryCoverageService,
  ) {}

  @Post('create')
  create(
    @Body() dto: CreateSubstituteSecretaryCoverageDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryCoverageService.create(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @Post('replace')
  replace(
    @Body() dto: ReplaceSubstituteSecretaryCoverageDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryCoverageService.replace(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @Post('cancel')
  cancel(
    @Body() dto: CancelSubstituteSecretaryCoverageDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryCoverageService.cancel(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
