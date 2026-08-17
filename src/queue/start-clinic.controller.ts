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
import { StartClinicDto } from './dto/start-clinic.dto';
import { StartClinicService } from './start-clinic.service';

@Controller('clinic-days')
export class StartClinicController {
  constructor(private readonly startClinicService: StartClinicService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('start')
  start(
    @Body() dto: StartClinicDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.startClinicService.start(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
