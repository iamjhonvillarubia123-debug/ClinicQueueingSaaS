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
import { AssignSubstituteSecretaryDto } from './dto/assign-substitute-secretary.dto';
import { EndSubstituteSecretaryDto } from './dto/end-substitute-secretary.dto';
import { ReplaceSubstituteSecretaryDto } from './dto/replace-substitute-secretary.dto';
import { SubstituteSecretaryService } from './substitute-secretary.service';

@Controller('clinic-days/substitute-secretary')
export class SubstituteSecretaryController {
  constructor(
    private readonly substituteSecretaryService: SubstituteSecretaryService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('assign')
  assign(
    @Body() dto: AssignSubstituteSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryService.assign(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('replace')
  replace(
    @Body() dto: ReplaceSubstituteSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryService.replace(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('end')
  end(
    @Body() dto: EndSubstituteSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.substituteSecretaryService.end(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
