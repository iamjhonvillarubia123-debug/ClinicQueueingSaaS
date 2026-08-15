import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { AssignPracticeStaffDto } from './dto/assign-practice-staff.dto';
import { PracticeStaffService } from './practice-staff.service';

interface AuthenticatedRequest {
  user: {
    userId: string;
    role: string;
  };
}

@Controller('practice-staff')
export class PracticeStaffController {
  constructor(private readonly practiceStaffService: PracticeStaffService) {}

  @UseGuards(JwtAuthGuard)
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
