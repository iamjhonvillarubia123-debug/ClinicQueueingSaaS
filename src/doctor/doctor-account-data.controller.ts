import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { DoctorAccountDataService } from './doctor-account-data.service';
export class ExportAccountDataDto {
  @IsString() @IsNotEmpty() @MaxLength(1024) currentPassword!: string;
  @IsIn(['ACCOUNT', 'SETTINGS']) kind!: 'ACCOUNT' | 'SETTINGS';
}
@Controller('doctor/account')
@UseGuards(SessionAuthGuard)
export class DoctorAccountDataController {
  constructor(private readonly data: DoctorAccountDataService) {}
  @Get('data-inventory')
  @Header('Cache-Control', 'no-store')
  inventory(@Request() request: AuthenticatedRequest) {
    return this.data.inventory(request.user);
  }
  @Post('export')
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfOriginGuard)
  @RateLimit({
    id: 'account-data-export',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  export(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ExportAccountDataDto,
  ) {
    return this.data.export(
      request.user,
      dto.currentPassword,
      dto.kind === 'SETTINGS',
    );
  }
}
