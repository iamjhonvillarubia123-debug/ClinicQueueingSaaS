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
    if (request.user.role !== UserRole.SYSTEM_ADMIN) {
      throw new ForbiddenException('SYSTEM_ADMIN authority is required.');
    }
    if (dto.targetDoctorUserId !== doctorUserId) {
      throw new ForbiddenException('Target Doctor identity mismatch.');
    }

    return this.systemAdminService.normalSuspendDoctor(
      request.user.userId,
      doctorUserId,
      dto.reasonCategory,
      dto.explanation,
      dto.adminPassword,
      idempotencyKey,
    );
  }
}
