import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateDoctorCalendarRuleDto } from './dto/create-doctor-calendar-rule.dto';
import { DoctorCalendarWorkspaceService } from './doctor-calendar-workspace.service';

@Controller('doctor-calendar')
export class DoctorCalendarController {
  constructor(private readonly calendar: DoctorCalendarWorkspaceService) {}

  @UseGuards(SessionAuthGuard)
  @Get()
  month(
    @Query('month') month: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.calendar.getMonth(request.user.userId, month);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('unavailable-dates')
  create(
    @Body() dto: CreateDoctorCalendarRuleDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.calendar.create(request.user.userId, dto.date, dto.label);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Delete('unavailable-dates/:ruleId')
  remove(
    @Param('ruleId') ruleId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.calendar.remove(request.user.userId, ruleId);
  }
}
