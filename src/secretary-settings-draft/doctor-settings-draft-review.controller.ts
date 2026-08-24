import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { DoctorSettingsDraftReviewReadService } from './doctor-settings-draft-review-read.service';

@Controller('doctor-settings-draft-reviews')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class DoctorSettingsDraftReviewController {
  constructor(private readonly readService: DoctorSettingsDraftReviewReadService) {}

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.readService.listSubmitted(request.user.userId);
  }

  @Get(':draftId')
  get(@Param('draftId') draftId: string, @Request() request: AuthenticatedRequest) {
    return this.readService.getSubmitted(request.user.userId, draftId);
  }
}
