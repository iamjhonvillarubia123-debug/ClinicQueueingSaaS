import {
  Controller,
  Get,
  Param,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { ApplicationNotificationService } from './application-notification.service';

@Controller('application-notifications')
@UseGuards(SessionAuthGuard)
export class ApplicationNotificationController {
  constructor(
    private readonly applicationNotificationService: ApplicationNotificationService,
  ) {}

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.applicationNotificationService.listForRecipient(
      request.user.userId,
    );
  }

  @Get('unread-count')
  unreadCount(@Request() request: AuthenticatedRequest) {
    return this.applicationNotificationService.unreadCount(request.user.userId);
  }

  @Patch(':notificationId/read')
  @UseGuards(CsrfOriginGuard)
  markRead(
    @Request() request: AuthenticatedRequest,
    @Param('notificationId') notificationId: string,
  ) {
    return this.applicationNotificationService.markRead(
      request.user.userId,
      notificationId,
    );
  }
}
