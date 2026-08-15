import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MobileNumberNormalizer } from './mobile-number-normalizer';
import { MobileNumberService } from './mobile-number.service';

@Module({
  imports: [ConfigModule],

  providers: [MobileNumberNormalizer, MobileNumberService],

  exports: [MobileNumberService],
})
export class MobileNumberModule {}
