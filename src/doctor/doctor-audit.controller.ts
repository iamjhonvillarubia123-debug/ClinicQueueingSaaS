import {
  Controller,
  Get,
  Header,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { DoctorAuditService } from './doctor-audit.service';
@Controller('doctor/audit-log')
@UseGuards(SessionAuthGuard)
export class DoctorAuditController {
  constructor(private readonly audit: DoctorAuditService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @RateLimit({
    id: 'doctor-audit-read',
    limit: 60,
    windowMs: 60000,
    subject: { kind: 'NONE' },
  })
  list(
    @Request() request: AuthenticatedRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page = '1',
  ) {
    return this.audit.list(request.user, from, to, Number(page));
  }
}
