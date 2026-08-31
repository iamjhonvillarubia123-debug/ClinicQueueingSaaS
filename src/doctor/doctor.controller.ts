import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { AccountRegistrationService } from '../auth/account-registration.service';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { DoctorDataRetentionService } from './doctor-data-retention.service';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';
import { AcknowledgeDataRetentionDto } from './dto/acknowledge-data-retention.dto';
import { ApplyDoctorDefaultsDto } from './dto/apply-doctor-defaults.dto';
import { PermanentlyDeleteDoctorDto } from './dto/permanently-delete-doctor.dto';
import { ReactivateDoctorDto } from './dto/reactivate-doctor.dto';
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { SaveDoctorBookingQuestionTemplateDto } from './dto/save-doctor-booking-question-template.dto';
import { SaveDoctorServiceTemplateDto } from './dto/save-doctor-service-template.dto';
import { UpdateDoctorAccountSettingsDto } from './dto/update-doctor-account-settings.dto';

@Controller('doctor')
export class DoctorController {
  constructor(
    private readonly accountRegistrationService: AccountRegistrationService,
    private readonly doctorService: DoctorService,
    private readonly doctorLifecycleService: DoctorLifecycleService,
    private readonly doctorDefaultsService: DoctorDefaultsService,
    private readonly doctorDefaultsApplyService: DoctorDefaultsApplyService,
    private readonly doctorDataRetentionService: DoctorDataRetentionService,
  ) {}

  @RateLimit({
    id: 'doctor-register',
    limit: 5,
    windowMs: 60 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Post('register')
  register(@Body() registerDoctorDto: RegisterDoctorDto) {
    return this.accountRegistrationService.register({
      firstName: registerDoctorDto.firstName,
      lastName: registerDoctorDto.lastName,
      email: registerDoctorDto.email,
      mobileNumber: registerDoctorDto.mobileNumber,
      password: registerDoctorDto.password,
      role: UserRole.DOCTOR,
    });
  }

  @UseGuards(SessionAuthGuard)
  @Get('account/settings')
  getAccountSettings(@Request() request: AuthenticatedRequest) {
    return this.doctorService.getAccountSettings(request.user.userId);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Patch('account/settings')
  updateAccountSettings(
    @Request() request: AuthenticatedRequest,
    @Body() dto: UpdateDoctorAccountSettingsDto,
  ) {
    return this.doctorService.updateAccountSettings(request.user.userId, dto);
  }

  @UseGuards(SessionAuthGuard)
  @Get('account/data-privacy')
  getDataPrivacyProfile(@Request() request: AuthenticatedRequest) {
    return this.doctorDataRetentionService.getDataPrivacyProfile(
      request.user.userId,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('account/data-retention-acknowledgement')
  acknowledgeDataRetention(
    @Request() request: AuthenticatedRequest,
    @Body() dto: AcknowledgeDataRetentionDto,
  ) {
    void dto;
    return this.doctorDataRetentionService.acknowledgeCurrentPolicy(
      request.user.userId,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get('defaults')
  getDefaults(@Request() request: AuthenticatedRequest) {
    return this.doctorDefaultsService.list(request.user.userId);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/services')
  saveServiceTemplate(
    @Request() request: AuthenticatedRequest,
    @Body() dto: SaveDoctorServiceTemplateDto,
  ) {
    return this.doctorDefaultsService.saveServiceTemplate(
      request.user.userId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/booking-questions')
  saveBookingQuestionTemplate(
    @Request() request: AuthenticatedRequest,
    @Body() dto: SaveDoctorBookingQuestionTemplateDto,
  ) {
    return this.doctorDefaultsService.saveBookingQuestionTemplate(
      request.user.userId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/apply')
  applyDefaults(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ApplyDoctorDefaultsDto,
  ) {
    return this.doctorDefaultsApplyService.apply(
      request.user.userId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('account/disable')
  disableAccount(
    @Request() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.doctorLifecycleService.disable(
      request.user.userId,
      idempotencyKey,
    );
  }

  @Post('account/reactivate')
  reactivateAccount(@Body() dto: ReactivateDoctorDto) {
    return this.doctorLifecycleService.reactivate(dto);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('account/permanently-delete')
  permanentlyDeleteAccount(
    @Request() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PermanentlyDeleteDoctorDto,
  ) {
    return this.doctorLifecycleService.permanentlyDelete(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get('account')
  getAccount(@Request() request: AuthenticatedRequest) {
    return this.doctorLifecycleService.getAccount(request.user.userId);
  }

  @UseGuards(SessionAuthGuard)
  @Get('defaults/services/:templateId')
  getServiceTemplate(
    @Request() request: AuthenticatedRequest,
    @Param('templateId') templateId: string,
  ) {
    return this.doctorDefaultsService.getServiceTemplate(
      request.user.userId,
      templateId,
    );
  }
}
