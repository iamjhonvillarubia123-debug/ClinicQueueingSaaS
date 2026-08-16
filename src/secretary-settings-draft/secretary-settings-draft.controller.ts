import {
  Body,
  Controller,
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
import { SaveSecretarySettingsDraftServiceDto } from './dto/save-secretary-settings-draft-service.dto';
import { UpsertSecretarySettingsDraftPracticeScheduleDto } from './dto/upsert-secretary-settings-draft-practice-schedule.dto';
import { UpsertSecretarySettingsDraftScheduleExceptionDto } from './dto/upsert-secretary-settings-draft-schedule-exception.dto';
import { SecretarySettingsDraftApprovalService } from './secretary-settings-draft-approval.service';
import { SecretarySettingsDraftBookingQuestionService } from './secretary-settings-draft-booking-question.service';
import { SecretarySettingsDraftExceptionService } from './secretary-settings-draft-exception.service';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftServiceProposalService } from './secretary-settings-draft-service.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Controller('secretary-settings-drafts')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class SecretarySettingsDraftController {
  constructor(
    private readonly secretarySettingsDraftService: SecretarySettingsDraftService,
    private readonly secretarySettingsDraftScheduleService: SecretarySettingsDraftScheduleService,
    private readonly secretarySettingsDraftExceptionService: SecretarySettingsDraftExceptionService,
    private readonly secretarySettingsDraftServiceProposalService: SecretarySettingsDraftServiceProposalService,
    private readonly secretarySettingsDraftBookingQuestionService: SecretarySettingsDraftBookingQuestionService,
    private readonly secretarySettingsDraftApprovalService: SecretarySettingsDraftApprovalService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateSecretarySettingsDraftDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.create(request.user.userId, dto);
  }

  @Post(':draftId/services')
  createServiceProposal(
    @Param('draftId') draftId: string,
    @Body() dto: SaveSecretarySettingsDraftServiceDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftServiceProposalService.createProposal(
      request.user.userId,
      draftId,
      dto,
    );
  }

  @Put(':draftId/services/effective/:practiceLocationServiceId')
  upsertExistingServiceProposal(
    @Param('draftId') draftId: string,
    @Param('practiceLocationServiceId') practiceLocationServiceId: string,
    @Body() dto: SaveSecretarySettingsDraftServiceDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftServiceProposalService.upsertExistingServiceProposal(
      request.user.userId,
      draftId,
      practiceLocationServiceId,
      dto,
    );
  }

  @Put(':draftId/services/proposals/:proposalId')
  updateServiceProposal(
    @Param('draftId') draftId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: SaveSecretarySettingsDraftServiceDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftServiceProposalService.updateProposal(
      request.user.userId,
      draftId,
      proposalId,
      dto,
    );
  }

  @Post(':draftId/booking-questions')
  createBookingQuestionProposal(
    @Param('draftId') draftId: string,
    @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftBookingQuestionService.createProposal(
      request.user.userId,
      draftId,
      dto,
    );
  }

  @Put(':draftId/booking-questions/effective/:bookingQuestionId')
  upsertExistingBookingQuestionProposal(
    @Param('draftId') draftId: string,
    @Param('bookingQuestionId') bookingQuestionId: string,
    @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftBookingQuestionService.upsertExistingQuestionProposal(
      request.user.userId,
      draftId,
      bookingQuestionId,
      dto,
    );
  }

  @Put(':draftId/booking-questions/proposals/:proposalId')
  updateBookingQuestionProposal(
    @Param('draftId') draftId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: SaveSecretarySettingsDraftBookingQuestionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftBookingQuestionService.updateProposal(
      request.user.userId,
      draftId,
      proposalId,
      dto,
    );
  }

  @Put(':draftId/practice-schedule')
  upsertPracticeSchedule(
    @Param('draftId') draftId: string,
    @Body() dto: UpsertSecretarySettingsDraftPracticeScheduleDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftScheduleService.upsertPracticeSchedule(
      request.user.userId,
      draftId,
      dto,
    );
  }

  @Put(':draftId/schedule-exception')
  upsertScheduleException(
    @Param('draftId') draftId: string,
    @Body() dto: UpsertSecretarySettingsDraftScheduleExceptionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftExceptionService.upsertScheduleException(
      request.user.userId,
      draftId,
      dto,
    );
  }

  @Post(':draftId/submit')
  submit(
    @Param('draftId') draftId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.submit(
      request.user.userId,
      draftId,
    );
  }

  @Post(':draftId/approve')
  approve(
    @Param('draftId') draftId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftApprovalService.approve(
      request.user.userId,
      draftId,
      idempotencyKey,
    );
  }

  @Post(':draftId/reject')
  reject(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.reject(
      request.user.userId,
      draftId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':draftId/return-for-rework')
  returnForRework(
    @Param('draftId') draftId: string,
    @Body() dto: ReviewSecretarySettingsDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.secretarySettingsDraftService.returnForRework(
      request.user.userId,
      draftId,
      dto,
      idempotencyKey,
    );
  }
}
