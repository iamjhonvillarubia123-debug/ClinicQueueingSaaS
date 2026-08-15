import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { OtpGenerator } from './otp.generator';
import { OtpService } from './otp.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [OtpGenerator, OtpService],
  exports: [OtpService],
})
export class OtpModule {}
