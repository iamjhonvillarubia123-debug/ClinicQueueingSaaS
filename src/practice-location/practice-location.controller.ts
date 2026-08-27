import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
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
import { SaveDoctorClinicConfigurationDraftDto } from './dto/save-doctor-clinic-configuration-draft.dto';
import { SaveDraftPracticeScheduleDto } from './dto/save-draft-practice-schedule.dto';
import { UpdatePracticeLocationDto } from './dto/update-practice-location.dto';
import { ValidatePracticeScheduleDto } from './dto/validate-practice-schedule.dto';
import { PracticeLocationActivationService } from './practice-location-activation.service';
import { PracticeLocationConfigurationDraftService } from './practice-location-configuration-draft.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';
import { PracticeLocationDraftScheduleService } from './practice-location-draft-schedule.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationService } from './practice-location.service';
import { PracticeSchedulePreflightService } from './practice-schedule-preflight.service';

@Controller('practice-location')
export class PracticeLocationController {
  constructor(
    private readonly practiceLocationService: PracticeLocationService,
    private readonly practiceLocationActivationService: PracticeLocationActivationService,
    private readonly practiceLocationConfigurationDraftService: PracticeLocationConfigurationDraftService,
    private readonly practiceLocationDataRetentionGateService: PracticeLocationDataRetentionGateService,
    private readonly practiceLocationDraftScheduleService: PracticeLocationDraftScheduleService,
    private readonly practiceLocationLifecycleService: PracticeLocationLifecycleService,
    private readonly practiceLocationPermanentDeleteService: PracticeLocationPermanentDeleteService,
    private readonly practiceSchedulePreflightService: PracticeSchedulePreflightService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Put(':practiceLocationId/configuration-draft')
  saveConfigurationDraft(
    @Param('practiceLocationId') practiceLocationId: string,
    @Body() dto: SaveDoctorClinicConfigurationDraftDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationConfigurationDraftService.save(
      request.user.userId,
      practiceLocationId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Put(':practiceLocationId/draft-schedule')
  saveDraftSchedule(
    @Param('practiceLocationId') practiceLocationId: string,
    @Body() dto: SaveDraftPracticeScheduleDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationDraftScheduleService.replaceDraftSchedule(
      request.user.userId,
      practiceLocationId,
      dto,
    );
  }

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
  @Patch(':practiceLocationId')
  update(
    @Param('practiceLocationId') practiceLocationId: string,
    @Body() dto: UpdatePracticeLocationDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationService.updateOwned(
      request.user.userId,
      practiceLocationId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('schedule-preflight')
  validateSchedule(
    @Body() dto: ValidatePracticeScheduleDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceSchedulePreflightService.validate(
      request.user.userId,
      dto,
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
