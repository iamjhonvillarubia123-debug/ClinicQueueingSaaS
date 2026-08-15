import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { PracticeStaffService } from './practice-staff.service';
import { PracticeStaffController } from './practice-staff.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [PracticeStaffService],
  controllers: [PracticeStaffController],
})
export class PracticeStaffModule {}
