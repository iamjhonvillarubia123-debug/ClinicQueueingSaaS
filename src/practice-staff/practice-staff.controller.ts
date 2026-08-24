import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';
import { RemoveRegularSecretaryDto } from './dto/remove-regular-secretary.dto';
import { ReplaceRegularSecretaryDto } from './dto/replace-regular-secretary.dto';
import { PracticeStaffReadService } from './practice-staff-read.service';
import { PracticeStaffService } from './practice-staff.service';

@Controller('practice-staff')
export class PracticeStaffController {
  constructor(
    private readonly practiceStaffService: PracticeStaffService,
    private readonly practiceStaffReadService: PracticeStaffReadService,
  ) {}

  @UseGuards(SessionAuthGuard)
  @Get('regular/:practiceLocationId')
  getRegular(
    @Param('practiceLocationId') practiceLocationId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffReadService.getClinicStaffing(request.user.userId, practiceLocationId);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/:practiceLocationId/resolve-existing')
  resolveExisting(
    @Param('practiceLocationId') practiceLocationId: string,
    @Body() body: { email: string },
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffReadService.resolveExistingSecretary(request.user.userId, practiceLocationId, body.email);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/assign')
  assignRegular(
    @Body() dto: AssignPracticeStaffDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffService.assignRegular(request.user.userId, dto, idempotencyKey);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/replace')
  replaceRegular(
    @Body() dto: ReplaceRegularSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffService.replaceRegular(request.user.userId, dto, idempotencyKey);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('regular/remove')
  removeRegular(
    @Body() dto: RemoveRegularSecretaryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffService.removeRegular(request.user.userId, dto, idempotencyKey);
  }
}
