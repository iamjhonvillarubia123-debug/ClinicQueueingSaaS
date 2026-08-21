import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

import { ActivatePracticeLocationDto } from './dto/activate-practice-location.dto';
import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { DisablePracticeLocationDto } from './dto/disable-practice-location.dto';
import { PermanentlyDeletePracticeLocationDto } from './dto/permanently-delete-practice-location.dto';
import { ReactivatePracticeLocationDto } from './dto/reactivate-practice-location.dto';
import { PracticeLocationActivationService } from './practice-location-activation.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationService } from './practice-location.service';

@Controller('practice-location')
export class PracticeLocationController {
  constructor(
    private readonly practiceLocationService: PracticeLocationService,
    private readonly practiceLocationActivationService: PracticeLocationActivationService,
    private readonly practiceLocationDataRetentionGateService: PracticeLocationDataRetentionGateService,
    private readonly practiceLocationLifecycleService: PracticeLocationLifecycleService,
    private readonly practiceLocationPermanentDeleteService: PracticeLocationPermanentDeleteService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post()
  create(
    @Body() createPracticeLocationDto: CreatePracticeLocationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationService.create(
      request.user.userId,
      createPracticeLocationDto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('activate')
  async activate(
    @Body() dto: ActivatePracticeLocationDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.practiceLocationDataRetentionGateService.assertCurrentAcknowledgement(
      request.user.userId,
    );
    return this.practiceLocationActivationService.activate(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('reactivate')
  async reactivate(
    @Body() dto: ReactivatePracticeLocationDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.practiceLocationDataRetentionGateService.assertCurrentAcknowledgement(
      request.user.userId,
    );
    return this.practiceLocationActivationService.reactivate(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('disable')
  disable(
    @Body() dto: DisablePracticeLocationDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationLifecycleService.disable(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('permanent-delete')
  permanentlyDelete(
    @Body() dto: PermanentlyDeletePracticeLocationDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationPermanentDeleteService.permanentlyDelete(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get()
  findAll(@Request() request: AuthenticatedRequest) {
    return this.practiceLocationService.findAllForDoctor(request.user.userId);
  }
}
