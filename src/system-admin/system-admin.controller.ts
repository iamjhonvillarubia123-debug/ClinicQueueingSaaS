import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { NormalRestoreDoctorDto } from './dto/normal-restore-doctor.dto';
import { NormalSuspendDoctorDto } from './dto/normal-suspend-doctor.dto';
import { SystemAdminService } from './system-admin.service';

@Controller('system-admin')
export class SystemAdminController {
  constructor(private readonly systemAdminService: SystemAdminService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('doctors/:doctorUserId/normal-suspend')
  normalSuspendDoctor(
    @Request() request: AuthenticatedRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Body() dto: NormalSuspendDoctorDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.assertSystemAdminTarget(request, doctorUserId, dto.targetDoctorUserId);

    return this.systemAdminService.normalSuspendDoctor(
      request.user.userId,
      doctorUserId,
      dto.reasonCategory,
      dto.explanation,
      dto.adminPassword,
      idempotencyKey,
    );
  }

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('doctors/:doctorUserId/normal-restore')
  normalRestoreDoctor(
    @Request() request: AuthenticatedRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Body() dto: NormalRestoreDoctorDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    this.assertSystemAdminTarget(request, doctorUserId, dto.targetDoctorUserId);

    return this.systemAdminService.normalRestoreDoctor(
      request.user.userId,
      doctorUserId,
      dto.resolutionText,
      dto.adminPassword,
      idempotencyKey,
    );
  }

  private assertSystemAdminTarget(
    request: AuthenticatedRequest,
    doctorUserId: string,
    suppliedTargetDoctorUserId: string,
  ): void {
    if (request.user.role !== UserRole.SYSTEM_ADMIN) {
      throw new ForbiddenException('SYSTEM_ADMIN authority is required.');
    }
    if (suppliedTargetDoctorUserId !== doctorUserId) {
      throw new ForbiddenException('Target Doctor identity mismatch.');
    }
  }
}
