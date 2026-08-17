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
import { StaffReinsertDto } from './dto/staff-reinsert.dto';
import { StaffReinsertService } from './staff-reinsert.service';

@Controller('clinic-days')
export class StaffReinsertController {
  constructor(private readonly staffReinsertService: StaffReinsertService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('staff-reinsert')
  reinsert(
    @Body() dto: StaffReinsertDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.staffReinsertService.reinsert(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
