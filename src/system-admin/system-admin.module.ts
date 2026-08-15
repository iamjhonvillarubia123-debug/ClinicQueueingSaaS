import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { SystemAdminEmergencyService } from './system-admin-emergency.service';
import { SystemAdminController } from './system-admin.controller';
import { SystemAdminService } from './system-admin.service';

@Module({
  imports: [PrismaModule, AuthModule, QueueModule],
  providers: [SystemAdminService, SystemAdminEmergencyService],
  controllers: [SystemAdminController],
})
export class SystemAdminModule {}
