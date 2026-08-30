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

import { ClinicSecretaryAuthorityService } from './clinic-secretary-authority.service';
import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';
import { RemoveRegularSecretaryDto } from './dto/remove-regular-secretary.dto';
import { ReplaceRegularSecretaryDto } from './dto/replace-regular-secretary.dto';

@Controller('practice-staff')
export class PracticeStaffController {
  constructor(
    private readonly clinicSecretaryAuthorityService: ClinicSecretaryAuthorityService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/assign')
  assignRegular(
    @Body() dto: AssignPracticeStaffDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.clinicSecretaryAuthorityService.assign(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/replace')
  replaceRegular(
    @Body() dto: ReplaceRegularSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.clinicSecretaryAuthorityService.replace(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/remove')
  removeRegular(
    @Body() dto: RemoveRegularSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.clinicSecretaryAuthorityService.remove(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
