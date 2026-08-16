import { Module } from '@nestjs/common';
import { CommandIdempotencyService } from './command-idempotency.service';

@Module({
  providers: [CommandIdempotencyService],
  exports: [CommandIdempotencyService],
})
export class IdempotencyModule {}
