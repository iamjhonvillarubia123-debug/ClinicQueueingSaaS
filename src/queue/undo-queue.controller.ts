import {
  Body,
  Controller,
  Headers,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { UndoQueueDto } from './dto/undo-queue.dto';
import { UndoQueueService } from './undo-queue.service';

@Controller('clinic-days')
export class UndoQueueController {
  constructor(private readonly undoQueueService: UndoQueueService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('undo')
  undo(
    @Body() dto: UndoQueueDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.undoQueueService.undo(request.user.userId, dto, idempotencyKey);
  }
}
