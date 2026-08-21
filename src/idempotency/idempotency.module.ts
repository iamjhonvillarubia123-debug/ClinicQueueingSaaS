import { Module } from '@nestjs/common';
import { CommandIdempotencyCleanupService } from './command-idempotency-cleanup.service';
import { CommandIdempotencyService } from './command-idempotency.service';

@Module({
  providers: [CommandIdempotencyService, CommandIdempotencyCleanupService],
  exports: [CommandIdempotencyService, CommandIdempotencyCleanupService],
})
export class IdempotencyModule {}
