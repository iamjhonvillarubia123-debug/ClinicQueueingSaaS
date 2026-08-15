import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';

import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';
import { PracticeStaffService } from './practice-staff.service';

@Controller('practice-staff')
export class PracticeStaffController {
  constructor(private readonly practiceStaffService: PracticeStaffService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('assign')
  assign(
    @Body() assignPracticeStaffDto: AssignPracticeStaffDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceStaffService.assign(
      request.user.userId,
      assignPracticeStaffDto,
    );
  }
}
