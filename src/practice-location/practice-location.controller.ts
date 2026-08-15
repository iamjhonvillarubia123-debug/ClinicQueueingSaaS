import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { PracticeLocationService } from './practice-location.service';

@Controller('practice-location')
export class PracticeLocationController {
  constructor(
    private readonly practiceLocationService: PracticeLocationService,
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

  @UseGuards(SessionAuthGuard)
  @Get()
  findAll(@Request() request: AuthenticatedRequest) {
    return this.practiceLocationService.findAllForDoctor(request.user.userId);
  }
}
