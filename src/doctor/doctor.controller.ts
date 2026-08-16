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
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';
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
    private readonly doctorService: DoctorService,
    private readonly doctorLifecycleService: DoctorLifecycleService,
    private readonly doctorDefaultsService: DoctorDefaultsService,
    private readonly doctorDefaultsApplyService: DoctorDefaultsApplyService,
  ) {}

  @Post('register')
  async register(@Body() registerDoctorDto: RegisterDoctorDto) {
    return this.doctorService.registerDoctor(registerDoctorDto);
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
  @Get('defaults')
  getDefaults(@Request() request: AuthenticatedRequest) {
    return this.doctorDefaultsService.list(request.user.userId);
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/services')
  createServiceTemplate(
    @Request() request: AuthenticatedRequest,
    @Body() dto: SaveDoctorServiceTemplateDto,
  ) {
    return this.doctorDefaultsService.createServiceTemplate(
      request.user.userId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Patch('defaults/services/:templateId')
  updateServiceTemplate(
    @Request() request: AuthenticatedRequest,
    @Param('templateId') templateId: string,
    @Body() dto: SaveDoctorServiceTemplateDto,
  ) {
    return this.doctorDefaultsService.updateServiceTemplate(
      request.user.userId,
      templateId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/booking-questions')
  createBookingQuestionTemplate(
    @Request() request: AuthenticatedRequest,
    @Body() dto: SaveDoctorBookingQuestionTemplateDto,
  ) {
    return this.doctorDefaultsService.createBookingQuestionTemplate(
      request.user.userId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Patch('defaults/booking-questions/:templateId')
  updateBookingQuestionTemplate(
    @Request() request: AuthenticatedRequest,
    @Param('templateId') templateId: string,
    @Body() dto: SaveDoctorBookingQuestionTemplateDto,
  ) {
    return this.doctorDefaultsService.updateBookingQuestionTemplate(
      request.user.userId,
      templateId,
      dto,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('defaults/apply')
  applyDefaults(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ApplyDoctorDefaultsDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.doctorDefaultsApplyService.apply(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('account/disable')
  disableAccount(
    @Request() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.doctorLifecycleService.disable(
      request.user.userId,
      idempotencyKey,
    );
  }

  @Post('account/reactivate')
  reactivateAccount(
    @Body() dto: ReactivateDoctorDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.doctorLifecycleService.reactivate(
      dto.email,
      dto.password,
      idempotencyKey,
    );
  }

  @Post('account/permanent-delete')
  permanentlyDeleteAccount(
    @Body() dto: PermanentlyDeleteDoctorDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.doctorLifecycleService.permanentlyDelete(
      dto.email,
      dto.password,
      dto.confirmPermanentDelete,
      idempotencyKey,
    );
  }
}
