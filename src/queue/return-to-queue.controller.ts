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
import { ReturnToQueueDto } from './dto/return-to-queue.dto';
import { ReturnToQueueService } from './return-to-queue.service';

@Controller('clinic-days')
export class ReturnToQueueController {
  constructor(private readonly returnToQueueService: ReturnToQueueService) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('return-to-queue')
  returnToQueue(
    @Body() dto: ReturnToQueueDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.returnToQueueService.returnToQueue(
      request.user.userId,
      dto,
      idempotencyKey,
    );
  }
}
