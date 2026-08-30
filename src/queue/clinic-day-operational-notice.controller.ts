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
import { ClinicDayOperationalNoticeService } from './clinic-day-operational-notice.service';
import {
  EndClinicDayOperationalNoticeDto,
  StartClinicDayOperationalNoticeDto,
} from './dto/clinic-day-operational-notice.dto';

@Controller('clinic-days/operational-notices')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class ClinicDayOperationalNoticeController {
  constructor(private readonly service: ClinicDayOperationalNoticeService) {}

  @Post('start')
  start(
    @Body() dto: StartClinicDayOperationalNoticeDto,
    @Headers('idempotency-key') key: string | undefined,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.service.start(request.user.userId, dto, key);
  }

  @Post('end')
  end(
    @Body() dto: EndClinicDayOperationalNoticeDto,
    @Headers('idempotency-key') key: string | undefined,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.service.end(request.user.userId, dto, key);
  }
}
