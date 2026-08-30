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
import { CreateStaffAppointmentDto } from './dto/create-staff-appointment.dto';
import { StaffAppointmentService } from './staff-appointment.service';

@Controller('booking')
export class StaffAppointmentController {
  constructor(private readonly service: StaffAppointmentService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('staff-appointment')
  create(
    @Body() dto: CreateStaffAppointmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.service.create(request.user.userId, dto, idempotencyKey);
  }
}
