import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OtpGenerator } from './otp.generator';
import { OtpService } from './otp.service';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationModule],
  providers: [OtpGenerator, OtpService],
  exports: [OtpGenerator, OtpService],
})
export class OtpModule {}
