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

import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { DisablePracticeLocationDto } from './dto/disable-practice-location.dto';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationService } from './practice-location.service';

@Controller('practice-location')
export class PracticeLocationController {
  constructor(
    private readonly practiceLocationService: PracticeLocationService,
    private readonly practiceLocationLifecycleService: PracticeLocationLifecycleService,
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

  @UseGuards(SessionAuthGuard)
  @Get()
  findAll(@Request() request: AuthenticatedRequest) {
    return this.practiceLocationService.findAllForDoctor(request.user.userId);
  }
}
