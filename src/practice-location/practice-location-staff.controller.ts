import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { PracticeLocationStaffReadService } from './practice-location-staff-read.service';

@Controller('practice-location')
export class PracticeLocationStaffController {
  constructor(
    private readonly practiceLocationStaffReadService: PracticeLocationStaffReadService,
  ) {}

  @UseGuards(SessionAuthGuard)
  @Get(':practiceLocationId/operations/staff')
  operationsStaff(
    @Param('practiceLocationId') practiceLocationId: string,
    @Query('serviceDate') serviceDate: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.practiceLocationStaffReadService.getStaff(
      request.user.userId,
      practiceLocationId,
      serviceDate,
    );
  }
}
