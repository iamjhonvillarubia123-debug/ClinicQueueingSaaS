import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { PracticeStaffAccessService } from './practice-staff-access.service';
import { PracticeStaffReadService } from './practice-staff-read.service';
import { PracticeStaffService } from './practice-staff.service';
import { PracticeStaffController } from './practice-staff.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [PracticeStaffService, PracticeStaffReadService, PracticeStaffAccessService],
  controllers: [PracticeStaffController],
})
export class PracticeStaffModule {}
