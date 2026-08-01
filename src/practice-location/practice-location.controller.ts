import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { PracticeLocationService } from './practice-location.service';

interface AuthenticatedRequest {
  user: {
    userId: string;
    role: string;
  };
}

@Controller('practice-location')
export class PracticeLocationController {
  constructor(
    private readonly practiceLocationService: PracticeLocationService,
  ) {}

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Request() request: AuthenticatedRequest) {
  return this.practiceLocationService.findAllForDoctor(
    request.user.userId,
  );
}
}