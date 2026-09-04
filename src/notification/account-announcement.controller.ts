import {
  Body,
  Controller,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AccountAnnouncementService } from './account-announcement.service';
export class PublishAnnouncementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recipientUserIds!: string[];
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;
  @IsString() @IsNotEmpty() @MaxLength(1024) currentPassword!: string;
}
@Controller('system-admin/account-announcements')
@UseGuards(SessionAuthGuard, CsrfOriginGuard)
export class AccountAnnouncementController {
  constructor(private readonly announcements: AccountAnnouncementService) {}
  @Post()
  @RateLimit({
    id: 'admin-announcement',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'NONE' },
  })
  publish(
    @Request() request: AuthenticatedRequest,
    @Body() dto: PublishAnnouncementDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.announcements.publish(
      request.user,
      dto.recipientUserIds,
      dto.title,
      dto.message,
      dto.currentPassword,
      key,
    );
  }
}
