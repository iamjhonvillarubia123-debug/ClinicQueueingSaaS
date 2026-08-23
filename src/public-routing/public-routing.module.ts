import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicQueueService } from './public-queue.service';
import { PublicRoutingController } from './public-routing.controller';
import { PublicRoutingService } from './public-routing.service';

@Module({
  imports: [PrismaModule, FinancialModule],
  providers: [PublicRoutingService, PublicQueueService],
  controllers: [PublicRoutingController],
  exports: [PublicRoutingService],
})
export class PublicRoutingModule {}
