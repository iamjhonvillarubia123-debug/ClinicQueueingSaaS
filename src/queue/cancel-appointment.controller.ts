import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CancelAppointmentService } from './cancel-appointment.service';
import { CancelAppointmentBodyDto } from './dto/cancel-appointment.dto';

@Controller('appointments')
export class CancelAppointmentController {
  constructor(
    private readonly cancelAppointmentService: CancelAppointmentService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post(':appointmentId/cancel')
  cancel(
    @Param('appointmentId') appointmentId: string,
    @Body() body: CancelAppointmentBodyDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.cancelAppointmentService.cancel(
      request.user.userId,
      { ...body, appointmentId },
      idempotencyKey,
    );
  }
}
