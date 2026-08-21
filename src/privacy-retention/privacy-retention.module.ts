import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrivacyRetentionService } from './privacy-retention.service';

@Module({
  imports: [PrismaModule],
  providers: [PrivacyRetentionService],
  exports: [PrivacyRetentionService],
})
export class PrivacyRetentionModule {}
