import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { DoctorProfileOnboardingService } from './doctor-profile-onboarding.service';
import { CompleteDoctorOnboardingDto } from './dto/complete-doctor-onboarding.dto';

@Controller('doctor/profile')
export class DoctorProfileOnboardingController {
  constructor(
    private readonly doctorProfileOnboardingService: DoctorProfileOnboardingService,
  ) {}

  @UseGuards(SessionAuthGuard)
  @Get()
  getProfileState(@Request() request: AuthenticatedRequest) {
    return this.doctorProfileOnboardingService.getProfileState(
      request.user.userId,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('onboarding')
  completeOnboarding(
    @Request() request: AuthenticatedRequest,
    @Body() dto: CompleteDoctorOnboardingDto,
  ) {
    return this.doctorProfileOnboardingService.completeOnboarding(
      request.user.userId,
      dto,
    );
  }
}
