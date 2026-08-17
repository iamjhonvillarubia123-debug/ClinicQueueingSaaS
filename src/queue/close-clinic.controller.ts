import { Body, Controller, Headers, Post, Request, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CloseClinicDto } from './dto/close-clinic.dto';
import { CloseClinicService } from './close-clinic.service';

@Controller('clinic-days')
export class CloseClinicController {
  constructor(private readonly closeClinicService: CloseClinicService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('close')
  close(
    @Body() dto: CloseClinicDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.closeClinicService.close(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
