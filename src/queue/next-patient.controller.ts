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
import { NextPatientDto } from './dto/next-patient.dto';
import { NextPatientService } from './next-patient.service';

@Controller('clinic-days')
export class NextPatientController {
  constructor(private readonly nextPatientService: NextPatientService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('next-patient')
  advance(
    @Body() dto: NextPatientDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.nextPatientService.advance(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
