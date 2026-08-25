import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';

import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { CreateSecretarySettingsDraftDto } from './dto/create-secretary-settings-draft.dto';
import { ReviewSecretarySettingsDraftDto } from './dto/review-secretary-settings-draft.dto';
import { SaveSecretarySettingsDraftBookingQuestionDto } from './dto/save-secretary-settings-draft-booking-question.dto';
import { SaveSecretarySettingsDraftClinicDetailsDto } from './dto/save-secretary-settings-draft-clinic-details.dto';
import { SaveSecretarySettingsDraftServiceDto } from './dto/save-secretary-settings-draft-service.dto';
import { UpsertSecretarySettingsDraftPracticeScheduleDto } from './dto/upsert-secretary-settings-draft-practice-schedule.dto';
import { UpsertSecretarySettingsDraftScheduleExceptionDto } from './dto/upsert-secretary-settings-draft-schedule-exception.dto';
import { SecretarySettingsDraftAccessService } from './secretary-settings-draft-access.service';
import { SecretarySettingsDraftApprovalService } from './secretary-settings-draft-approval.service';
import { SecretarySettingsDraftBookingQuestionService } from './secretary-settings-draft-booking-question.service';
import { SecretarySettingsDraftClinicDetailsService } from './secretary-settings-draft-clinic-details.service';
import { SecretarySettingsDraftExceptionService } from './secretary-settings-draft-exception.service';
import { SecretarySettingsDraftReadService } from './secretary-settings-draft-read.service';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftServiceProposalService } from './secretary-settings-draft-service.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Controller('secretary-settings-drafts')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class SecretarySettingsDraftController {
  constructor(
    private readonly secretarySettingsDraftService: SecretarySettingsDraftService,
    private readonly secretarySettingsDraftReadService: SecretarySettingsDraftReadService,
    private readonly secretarySettingsDraftAccessService: SecretarySettingsDraftAccessService,
    private readonly secretarySettingsDraftClinicDetailsService: SecretarySettingsDraftClinicDetailsService,
    private readonly secretarySettingsDraftScheduleService: SecretarySettingsDraftScheduleService,
    private readonly secretarySettingsDraftExceptionService: SecretarySettingsDraftExceptionService,
    private readonly secretarySettingsDraftServiceProposalService: SecretarySettingsDraftServiceProposalService,
    private readonly secretarySettingsDraftBookingQuestionService: SecretarySettingsDraftBookingQuestionService,
    private readonly secretarySettingsDraftApprovalService: SecretarySettingsDraftApprovalService,
  ) {}

  @Get(':draftId')
  getDraft(@Param('draftId') draftId: string, @Request() request: AuthenticatedRequest) {
    return this.secretarySettingsDraftReadService.getDraft(request.user.userId, draftId);
  }

  @Post()
  async create(@Body() dto: CreateSecretarySettingsDraftDto, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMayCreateDraft(request.user.userId, dto.practiceLocationId);
    return this.secretarySettingsDraftService.create(request.user.userId, dto);
  }

  @Put(':draftId/clinic-details')
  async upsertClinicDetails(
    @Param('draftId') draftId: string,
    @Body() dto: SaveSecretarySettingsDraftClinicDetailsDto,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'CLINIC_DETAILS');
    return this.secretarySettingsDraftClinicDetailsService.upsert(request.user.userId, draftId, dto);
  }

  @Post(':draftId/services')
  async createServiceProposal(@Param('draftId') draftId: string, @Body() dto: SaveSecretarySettingsDraftServiceDto, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SERVICES');
    return this.secretarySettingsDraftServiceProposalService.createProposal(request.user.userId, draftId, dto);
  }

  @Put(':draftId/services/effective/:practiceLocationServiceId')
  async upsertExistingServiceProposal(
    @Param('draftId') draftId: string,
    @Param('practiceLocationServiceId') practiceLocationServiceId: string,
    @Body() dto: SaveSecretarySettingsDraftServiceDto,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SERVICES');
    return this.secretarySettingsDraftServiceProposalService.upsertExistingServiceProposal(request.user.userId, draftId, practiceLocationServiceId, dto);
  }

  @Put(':draftId/services/proposals/:proposalId')
  async updateServiceProposal(
    @Param('draftId') draftId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: SaveSecretarySettingsDraftServiceDto,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SERVICES');
    return this.secretarySettingsDraftServiceProposalService.updateProposal(request.user.userId, draftId, proposalId, dto);
  }

  @Post(':draftId/booking-questions')
  async createBookingQuestionProposal(@Param('draftId') draftId: string, @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'BOOKING_QUESTIONS');
    return this.secretarySettingsDraftBookingQuestionService.createProposal(request.user.userId, draftId, dto);
  }

  @Put(':draftId/booking-questions/effective/:bookingQuestionId')
  async upsertExistingBookingQuestionProposal(
    @Param('draftId') draftId: string,
    @Param('bookingQuestionId') bookingQuestionId: string,
    @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'BOOKING_QUESTIONS');
    return this.secretarySettingsDraftBookingQuestionService.upsertExistingQuestionProposal(request.user.userId, draftId, bookingQuestionId, dto);
  }

  @Put(':draftId/booking-questions/proposals/:proposalId')
  async updateBookingQuestionProposal(
    @Param('draftId') draftId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'BOOKING_QUESTIONS');
    return this.secretarySettingsDraftBookingQuestionService.updateProposal(request.user.userId, draftId, proposalId, dto);
  }

  @Put(':draftId/practice-schedule')
  async upsertPracticeSchedule(@Param('draftId') draftId: string, @Body() dto: UpsertSecretarySettingsDraftPracticeScheduleDto, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SCHEDULES');
    return this.secretarySettingsDraftScheduleService.upsertPracticeSchedule(request.user.userId, draftId, dto);
  }

  @Put(':draftId/schedule-exception')
  async upsertScheduleException(@Param('draftId') draftId: string, @Body() dto: UpsertSecretarySettingsDraftScheduleExceptionDto, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SCHEDULES');
    return this.secretarySettingsDraftExceptionService.upsertScheduleException(request.user.userId, draftId, dto);
  }

  @Delete(':draftId/schedule-exception/:serviceDate')
  async deleteScheduleException(
    @Param('draftId') draftId: string,
    @Param('serviceDate') serviceDate: string,
    @Request() request: AuthenticatedRequest,
  ) {
    await this.secretarySettingsDraftAccessService.assertMayEditDraft(request.user.userId, draftId, 'SCHEDULES');
    return this.secretarySettingsDraftExceptionService.deleteScheduleException(request.user.userId, draftId, serviceDate);
  }

  @Post(':draftId/submit')
  async submit(@Param('draftId') draftId: string, @Request() request: AuthenticatedRequest) {
    await this.secretarySettingsDraftAccessService.assertMaySubmitDraft(request.user.userId, draftId);
    return this.secretarySettingsDraftService.submit(request.user.userId, draftId);
  }

  @Post(':draftId/approve')
  approve(@Param('draftId') draftId: string, @Headers('idempotency-key') idempotencyKey: string, @Request() request: AuthenticatedRequest) {
    return this.secretarySettingsDraftApprovalService.approve(request.user.userId, draftId, idempotencyKey);
  }

  @Post(':draftId/reject')
  reject(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.reject(request.user.userId, draftId, dto, idempotencyKey);
  }

  @Post(':draftId/return-for-rework')
  returnForRework(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.returnForRework(request.user.userId, draftId, dto, idempotencyKey);
  }
}
