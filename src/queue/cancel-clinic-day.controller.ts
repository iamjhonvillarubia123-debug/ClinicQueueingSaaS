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
import { CancelClinicDayService } from './cancel-clinic-day.service';
import { CancelClinicDayDto } from './dto/cancel-clinic-day.dto';

@Controller('clinic-days')
export class CancelClinicDayController {
  constructor(
    private readonly cancelClinicDayService: CancelClinicDayService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('cancel')
  cancel(
    @Body() dto: CancelClinicDayDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.cancelClinicDayService.cancel(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
